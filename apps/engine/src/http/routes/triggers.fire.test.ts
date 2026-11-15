import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-trigger-fire-'))

const { describe, expect, it, beforeAll } = await import('vitest')
const { createServer } = await import('../server.js')
const { writeTrigger } = await import('../../triggers/loader.js')

const agentId = 'fireagent'
const app = createServer()

let token = ''

beforeAll(async () => {
    const created = await writeTrigger(agentId, { name: 'Fire me', body: 'Run.', methods: ['POST'] })
    token = created.token
    await writeTrigger(agentId, { name: 'Paused', body: 'Run.', enabled: false })
})

function fire(slug: string, body: Record<string, unknown>) {
    return app.request(`/agents/${agentId}/triggers/${slug}/fire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

const validPayload = (patch: Record<string, unknown> = {}) => ({ token, method: 'POST', query: '', contentType: 'application/json', body: '{}', bodyBytes: 2, ...patch })

describe('POST /agents/:id/triggers/:slug/fire', () => {
    it('answers 404 on a wrong token, without saying the trigger exists', async () => {
        const res = await fire('fire-me', validPayload({ token: 'wrong-token-000000000' }))
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'trigger not found' })
    })

    it('answers 404 on a token of a different length', async () => {
        expect((await fire('fire-me', validPayload({ token: 'short' }))).status).toBe(404)
    })

    it('answers 404 for a disabled trigger even with the right token', async () => {
        const { readTrigger } = await import('../../triggers/loader.js')
        const paused = await readTrigger(agentId, 'paused')
        expect((await fire('paused', validPayload({ token: paused.token }))).status).toBe(404)
    })

    it('answers 404 for an unknown trigger', async () => {
        expect((await fire('nope', validPayload())).status).toBe(404)
    })

    it('answers 404 for a slug trying to climb out of the triggers directory', async () => {
        const res = await app.request(`/agents/${agentId}/triggers/${encodeURIComponent('../../secret')}/fire`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(validPayload()),
        })
        expect(res.status).toBe(404)
    })

    it('answers 405 with the allowed methods when the caller used another verb', async () => {
        const res = await fire('fire-me', validPayload({ method: 'GET' }))
        expect(res.status).toBe(405)
        expect(await res.json()).toEqual({ error: 'method not allowed', allow: ['POST'] })
    })
})
