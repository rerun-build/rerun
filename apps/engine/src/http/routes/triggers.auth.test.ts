import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-trigger-auth-'))
process.env.RERUN_API_KEY = 'dev-key'
process.env.RERUN_LOG_LEVEL = 'fatal'

const fired = vi.hoisted(() => ({ calls: [] as Array<{ agentId: string; message: string }> }))
vi.mock('../../runtime/trigger-runner.js', () => ({
    fireTrigger: async (agentId: string, _trigger: unknown, message: string) => {
        fired.calls.push({ agentId, message })
        return { runId: 'run-1', sessionId: 'sess-1' }
    },
}))

const { describe, expect, it } = await import('vitest')
const { createServer } = await import('../server.js')

const app = createServer()
const auth = { authorization: 'Bearer dev-key', 'content-type': 'application/json' }

describe('trigger create and fire with the engine key set', () => {
    it('refuses create and fire without the key', async () => {
        const create = await app.request('/agents/a1/triggers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'stage', body: 'go' }) })
        expect(create.status).toBe(401)
        const fire = await app.request('/agents/a1/triggers/stage/fire', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'x', method: 'POST' }) })
        expect(fire.status).toBe(401)
        expect(fired.calls).toHaveLength(0)
    })

    it('creates a trigger and fires it with the key and the trigger token', async () => {
        const create = await app.request('/agents/a1/triggers', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'stage', body: 'go' }) })
        expect(create.status).toBe(201)
        const trigger = (await create.json()) as { slug: string; token: string }
        expect(trigger.slug).toBe('stage')

        const wrong = await app.request('/agents/a1/triggers/stage/fire', { method: 'POST', headers: auth, body: JSON.stringify({ token: 'wrong', method: 'POST' }) })
        expect(wrong.status).toBe(404)

        const fire = await app.request('/agents/a1/triggers/stage/fire', { method: 'POST', headers: auth, body: JSON.stringify({ token: trigger.token, method: 'POST', body: '{"packet":1}' }) })
        expect(fire.status).toBe(202)
        expect(await fire.json()).toEqual({ runId: 'run-1', sessionId: 'sess-1', triggerSlug: 'stage' })
        expect(fired.calls).toHaveLength(1)
    })
})
