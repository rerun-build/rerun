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

    it('rejects a verbosity level that is not one of the four', async () => {
        const app = createServer()
        const res = await app.request(`/agents/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verbosity: 'chatty' }) })
        expect(res.status).toBe(400)
    })

    it('persists the skim page switch and keeps it on a later patch', async () => {
        expect((await patchConfig({ pages: { skim: true } })).config.pages).toEqual({ skim: true })
        expect((await patchConfig({ verbosity: 'concise' })).config.pages).toEqual({ skim: true })
        expect((await patchConfig({ pages: { skim: false } })).config.pages).toEqual({ skim: false })
    })

    it('rejects standing instructions as pages turned on', async () => {
        const app = createServer()
        const res = await app.request(`/agents/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pages: { standingInstructions: true } }) })
        expect(res.status).toBe(400)
    })

    it('persists a valid thinking level', async () => {
        const { config } = await patchConfig({ thinkingLevel: 'high' })
        expect(config.thinkingLevel).toBe('high')
        expect((await patchConfig({ tools: { shell: false } })).config.thinkingLevel).toBe('high')
    })

    it('rejects a thinking level that is not low, medium or high', async () => {
        const app = createServer()
        const res = await app.request(`/agents/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thinkingLevel: 'extreme' }) })
        expect(res.status).toBe(400)
    })

    it('repoints the agent at another box connection', async () => {
        const { config } = await patchConfig({ connectionId: 'cnx-other', provider: 'anthropic', model: 'claude-sonnet-4-6' })
        expect(config.connectionId).toBe('cnx-other')
        expect(config.provider).toBe('anthropic')
        expect(config.model).toBe('claude-sonnet-4-6')
    })

    it('detaches the agent from its connection with null', async () => {
        const { config } = await patchConfig({ connectionId: null })
        expect(config.connectionId).toBeNull()
    })

    it('clears the pin back to the box default', async () => {
        const { config } = await patchConfig({ connectionId: null, provider: null, model: null })
        expect(config.model).toBeNull()
        expect(config.provider).toBeNull()
        expect(config.connectionId).toBeNull()
    })

    it('keeps an explicit pin across an unrelated patch', async () => {
        await patchConfig({ verbosity: 'concise' })
        expect((await patchConfig({ tools: { shell: false } })).config.model).toBe('acme/router-large')
    })

    it('writes the install prompt and merges the setup answer', async () => {
        const detail = await patchConfig({ install: 'Ask for the Stripe key, then test it.', setup: { required: true } })
        expect(detail.install.trim()).toBe('Ask for the Stripe key, then test it.')
        expect(detail.config.setup).toEqual({ required: true, completedAt: null, sessionId: null })
    })

    it('erases the install prompt when it is sent empty', async () => {
        await patchConfig({ install: 'Ask for the Stripe key.', setup: { required: true } })
        const detail = await patchConfig({ install: '', setup: { required: false, completedAt: '2026-08-13T00:00:00.000Z' } })
        expect(detail.install).toBe('')
        expect(detail.config.setup).toEqual({ required: false, completedAt: '2026-08-13T00:00:00.000Z', sessionId: null })
    })
})

describe('POST /agents', () => {
    beforeAll(() => migrate())

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
