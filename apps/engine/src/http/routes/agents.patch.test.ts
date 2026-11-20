import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-patch-'))

const { beforeAll, describe, expect, it, beforeEach } = await import('vitest')
const { agentRoutes } = await import('./agents.js')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { migrate } = await import('../../db/migrate.js')
const { mkdir } = await import('node:fs/promises')
const { agentDir } = await import('../../config/paths.js')

const id = 'patchagent'

type Detail = { config: Record<string, unknown>; install: string }

async function seedAgent() {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'patch', description: 'A configured agent', connectionId: 'cnx-router', provider: 'openrouter', model: 'acme/router-large' }))
}

async function patchConfig(body: unknown): Promise<Detail> {
    const res = await agentRoutes.request(`/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return (await res.json()) as Detail
}

describe('PATCH /agents/:id', () => {
    beforeEach(seedAgent)

    // Zod's `.partial()` keeps every `.default()`, so parsing a one-field body hands back a whole
    // config with provider, model and description reverted. Anything the caller did not send has to
    // survive, or saving the verbosity silently resets the model.
    it('leaves untouched fields alone instead of reverting them to their defaults', async () => {
        const { config } = await patchConfig({ verbosity: 'concise' })
        expect(config.verbosity).toBe('concise')
        expect(config.provider).toBe('openrouter')
        expect(config.model).toBe('acme/router-large')
        expect(config.description).toBe('A configured agent')
        expect(config.connectionId).toBe('cnx-router')
    })

    it('carries the verbosity level through and defaults it to normal', async () => {
        expect((await patchConfig({ tools: { shell: false } })).config.verbosity).toBe('normal')
        const { config } = await patchConfig({ verbosity: 'concise' })
        expect(config.verbosity).toBe('concise')
        expect(config.model).toBe('acme/router-large')
    })

    it('keeps the effort with the model it was picked for, and drops it when the model changes', async () => {
        expect((await patchConfig({ model: 'acme/router-large', effort: 'high' })).config.effort).toBe('high')
        expect((await patchConfig({ verbosity: 'concise' })).config.effort).toBe('high')
        expect((await patchConfig({ model: 'acme/router-large' })).config.effort).toBe('high')
        expect((await patchConfig({ connectionId: 'cnx-other', provider: 'anthropic', model: 'claude-sonnet-5-5' })).config.effort).toBeNull()
        expect((await patchConfig({ model: 'claude-opus-5-5', effort: 'low' })).config.effort).toBe('low')
        expect((await patchConfig({ connectionId: null, provider: null, model: null })).config.effort).toBeNull()
    })

    it('rejects a verbosity level that is not one of the four', async () => {
        const app = createServer()
        const res = await app.request(`/agents/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verbosity: 'chatty' }) })
        expect(res.status).toBe(400)
    })

    it('repoints the agent at another box connection', async () => {
        const { config } = await patchConfig({ connectionId: 'cnx-other', provider: 'anthropic', model: 'claude-sonnet-4-6' })
        expect(config.connectionId).toBe('cnx-other')
        expect(config.provider).toBe('anthropic')
        expect(config.model).toBe('claude-sonnet-4-6')
    })

    // A PATCH cannot clear a field by sending `undefined` (JSON drops it), so null is the way back
    // to "no connection of its own", which resolves to a box fallback at load time.
    it('detaches the agent from its connection with null', async () => {
        const { config } = await patchConfig({ connectionId: null })
        expect(config.connectionId).toBeNull()
    })

    // Null is also how the picker says "stop choosing": the agent then runs whatever the box does.
    it('clears the pin back to the box default', async () => {
        const { config } = await patchConfig({ connectionId: null, provider: null, model: null })
        expect(config.model).toBeNull()
        expect(config.provider).toBeNull()
        expect(config.connectionId).toBeNull()
    })

    // Existing agents carry provider and model written on disk, so flipping the schema defaults to
    // null cannot unpin them behind the user's back.
    it('keeps an explicit pin across an unrelated patch', async () => {
        await patchConfig({ verbosity: 'concise' })
        expect((await patchConfig({ tools: { shell: false } })).config.model).toBe('acme/router-large')
    })

    it('merges the check-in settings instead of dropping the model they pin', async () => {
        await patchConfig({ proactive: { enabled: true, connectionId: 'cnx-router', model: 'acme/router-small' } })
        expect((await patchConfig({ proactive: { enabled: false } })).config.proactive).toEqual({ enabled: false, connectionId: 'cnx-router', model: 'acme/router-small' })
    })

    it('writes the install prompt and merges the setup answer', async () => {
        const detail = await patchConfig({ install: 'Ask for the Stripe key, then test it.', setup: { required: true } })
        expect(detail.install.trim()).toBe('Ask for the Stripe key, then test it.')
        expect(detail.config.setup).toEqual({ required: true, completedAt: null, sessionId: null })
    })

    // Answering "no setup needed" has to take the instructions away with it: a leftover INSTALL.md
    // would be replayed by every copy of the agent.
    it('erases the install prompt when it is sent empty', async () => {
        await patchConfig({ install: 'Ask for the Stripe key.', setup: { required: true } })
        const detail = await patchConfig({ install: '', setup: { required: false, completedAt: '2026-08-13T00:00:00.000Z' } })
        expect(detail.install).toBe('')
        expect(detail.config.setup).toEqual({ required: false, completedAt: '2026-08-13T00:00:00.000Z', sessionId: null })
    })
})

describe('POST /agents', () => {
    beforeAll(() => migrate())

    // An agent built from outside the app should not need a follow-up PATCH to carry the setup it
    // was designed with: the folder is complete on the first call or the template capture is not.
    it('creates an agent with its install prompt and setup answer', async () => {
        const res = await agentRoutes.request('/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: { name: 'setupagent', setup: { required: true } }, soul: 'A test agent.', install: 'Ask for the API key.' }),
        })
        expect(res.status).toBe(201)

        const detail = (await res.json()) as Detail
        expect(detail.install.trim()).toBe('Ask for the API key.')
        expect(detail.config.setup).toEqual({ required: true, completedAt: null, sessionId: null })
    })
})
