import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-triggers-routes-'))
process.env.RERUN_API_KEY = ''

const fired = vi.hoisted(() => [] as { agentId: string; slug: string; message: string }[])

vi.mock('../../runtime/trigger-runner.js', () => ({
    fireTrigger: async (agentId: string, trigger: { slug: string }, message: string) => {
        fired.push({ agentId, slug: trigger.slug, message })
        return { runId: `run-${fired.length}`, sessionId: `session-${fired.length}` }
    },
}))

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')

const id = 'triggerroutes'
const app = createServer()
const base = `/agents/${id}/triggers`

type Trigger = { slug: string; name: string; description: string; body: string; token: string; methods: string[]; enabled: boolean; connectionId: string | null; provider: string | null; model: string | null }

function send(method: string, path: string, body?: unknown) {
    return app.request(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function create(body: Record<string, unknown>): Promise<Trigger> {
    const res = await send('POST', '', body)
    expect(res.status).toBe(201)
    return (await res.json()) as Trigger
}

function fire(slug: string, token: string, extra: Record<string, unknown> = {}) {
    return send('POST', `/${slug}/fire`, { token, method: 'POST', body: '{"order":42}', contentType: 'application/json', bodyBytes: 12, ...extra })
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'triggers' }))
})

describe('trigger routes', () => {
    it('creates an enabled POST trigger with its own token', async () => {
        const trigger = await create({ name: 'New Order', body: 'Handle the order.' })
        expect(trigger).toMatchObject({ slug: 'new-order', description: '', methods: ['POST'], enabled: true, provider: null, model: null })
        expect(trigger.token.length).toBeGreaterThan(10)

        const { triggers } = (await (await send('GET', '')).json()) as { triggers: Trigger[] }
        expect(triggers.map(t => t.slug)).toEqual(['new-order'])
    })

    it('refuses a trigger without a body or with no method', async () => {
        expect((await send('POST', '', { name: 'Empty', body: '' })).status).toBe(400)
        expect((await send('POST', '', { name: 'No methods', body: 'x', methods: [] })).status).toBe(400)
    })

    it('answers 500 on a name with no letter or digit', async () => {
        expect((await send('POST', '', { name: '!!!', body: 'x' })).status).toBe(500)
    })

    it.each([
        ['GET', '/nope'],
        ['PATCH', '/nope'],
        ['POST', '/nope/rotate'],
        ['DELETE', '/nope'],
    ])('%s %s answers 404', async (method, path) => {
        const res = await send(method, path, method === 'PATCH' ? { enabled: false } : undefined)
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'trigger not found' })
    })

    it('patches only the fields it is given and keeps the token', async () => {
        const created = await create({ name: 'Merge Hook', description: 'first', body: 'Original.', methods: ['POST', 'PUT'], connectionId: 'cnx', provider: 'anthropic', model: 'claude-sonnet-4-6' })
        const res = await send('PATCH', '/merge-hook', { description: 'second', enabled: false })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ name: 'Merge Hook', description: 'second', enabled: false, body: 'Original.', methods: ['POST', 'PUT'], token: created.token, connectionId: 'cnx', provider: 'anthropic', model: 'claude-sonnet-4-6' })
    })

    it('clears the model pin with null', async () => {
        await create({ name: 'Unpin Hook', body: 'x', connectionId: 'cnx', provider: 'anthropic', model: 'claude-sonnet-4-6' })
        const res = await send('PATCH', '/unpin-hook', { connectionId: null, provider: null, model: null, methods: ['GET'] })
        expect(await res.json()).toMatchObject({ connectionId: null, provider: null, model: null, methods: ['GET'] })
        expect(await (await send('GET', '/unpin-hook')).json()).toMatchObject({ connectionId: null, model: null })
    })

    it('fires with the right token and hands the request to the run', async () => {
        const trigger = await create({ name: 'Fire Hook', body: 'Process the payload.' })
        const res = await fire('fire-hook', trigger.token)
        expect(res.status).toBe(202)
        const result = (await res.json()) as { runId: string; sessionId: string; triggerSlug: string }
        expect(result.triggerSlug).toBe('fire-hook')
        expect(fired.at(-1)).toMatchObject({ agentId: id, slug: 'fire-hook' })
        expect(fired.at(-1)?.message).toContain('Process the payload.')
        expect(fired.at(-1)?.message).toContain('<trigger_payload trigger="fire-hook" method="POST"')
        expect(fired.at(-1)?.message).toContain('"order": 42')
    })

    it('refuses a fire body that does not match the contract', async () => {
        const trigger = await create({ name: 'Strict Hook', body: 'x' })
        const before = fired.length
        expect((await send('POST', '/strict-hook/fire', { token: trigger.token })).status).toBe(400)
        expect((await send('POST', '/strict-hook/fire', { token: trigger.token, method: 'TRACE' })).status).toBe(400)
        expect(fired).toHaveLength(before)
    })

    it('rotates the token and stops honouring the old one', async () => {
        const trigger = await create({ name: 'Rotate Hook', body: 'x' })
        const res = await send('POST', '/rotate-hook/rotate')
        expect(res.status).toBe(200)
        const rotated = (await res.json()) as Trigger
        expect(rotated.token).not.toBe(trigger.token)

        expect((await fire('rotate-hook', trigger.token)).status).toBe(404)
        expect((await fire('rotate-hook', rotated.token)).status).toBe(202)
    })

    it('deletes a trigger', async () => {
        await create({ name: 'Delete Hook', body: 'x' })
        const res = await send('DELETE', '/delete-hook')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ deleted: 'delete-hook' })
        expect((await send('GET', '/delete-hook')).status).toBe(404)
    })
})
