import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-server-errors-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { HTTPException } = await import('hono/http-exception')
const { z } = await import('zod')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('./server.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')

const id = 'erroragent'
const app = createServer()
app.get('/__test/http-exception', () => {
    throw new HTTPException(418, { message: 'short and stout' })
})
app.get('/__test/empty-zod', () => {
    const parsed = z.string().safeParse(1)
    if (parsed.success) return new Response('unreachable')
    parsed.error.issues.length = 0
    throw parsed.error
})

function post(path: string, body: string) {
    return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'errors' }))
})

describe('server error mapping', () => {
    it('turns a field-level zod error into "path: message"', async () => {
        const res = await post(`/agents/${id}/schedules`, JSON.stringify({ body: 'Do it', cron: '0 9 * * *' }))
        expect(res.status).toBe(400)
        const { error } = (await res.json()) as { error: string }
        expect(error).toMatch(/^name: /)
    })

    it('labels an object-level refinement as "body"', async () => {
        const res = await post(`/agents/${id}/schedules`, JSON.stringify({ name: 'Daily', body: 'Do it' }))
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'body: Provide exactly one of cron or runAt' })
    })

    it('joins several issues with a semicolon', async () => {
        const res = await post(`/agents/${id}/memories`, JSON.stringify({ content: '', tags: 'nope' }))
        expect(res.status).toBe(400)
        const { error } = (await res.json()) as { error: string }
        expect(error.split('; ').map(part => part.split(':')[0])).toEqual(['content', 'tags'])
    })

    it('falls back to a generic message for a zod error with no issue', async () => {
        const res = await app.request('/__test/empty-zod')
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'Invalid request body' })
    })

    it('answers an HttpError with its own status and message', async () => {
        const res = await app.request('/agents/ghost/skills')
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'agent not found' })
    })

    it('maps a path escaping its root to a 400 carrying the path', async () => {
        const res = await app.request(`/agents/${id}/files/read?path=${encodeURIComponent('../../outside.txt')}`)
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'Path escapes the root: ../../outside.txt' })
    })

    it('passes an HTTPException response through untouched', async () => {
        const res = await app.request('/__test/http-exception')
        expect(res.status).toBe(418)
        expect(await res.text()).toBe('short and stout')
    })

    it('answers 500 without leaking the cause on an unexpected error', async () => {
        const res = await post(`/agents/${id}/schedules`, '{not json')
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: 'Internal server error' })
    })
})
