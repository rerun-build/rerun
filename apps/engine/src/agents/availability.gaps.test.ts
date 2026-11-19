import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Provider } from '@moldwright/contracts'
import type { LoadedAgent } from './types.js'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-availability-gaps-'))
process.env.RERUN_HUB_BASE_URL = 'https://hub.example.com'
process.env.RERUN_API_KEY = 'hub-key'

const { afterEach, beforeEach, describe, expect, it, vi } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { DEFAULT_CONNECTION_MODELS, RERUN_CONNECTION_ID, RERUN_MODEL, agentConfigSchema } = await import('@moldwright/contracts')
const { connectionsDir } = await import('../config/paths.js')
const { createConnection, ensureMoldwrightConnection } = await import('../connections/store.js')
const { clearAgentCache } = await import('./registry.js')
const { clearBoxDefault } = await import('../connections/default.js')
const { logger } = await import('../lib/logger.js')
const { automationModel, resolveConfiguredModel } = await import('./availability.js')

let seq = 0

async function connect(provider: Provider, keys: Record<string, string>) {
    seq += 1
    return createConnection({ name: `${provider}-${seq}`, provider, models: DEFAULT_CONNECTION_MODELS[provider], extraModels: [], keys })
}

async function makeAgent(connectionId: string | null, provider: Provider | null, model: string | null): Promise<LoadedAgent> {
    const config = agentConfigSchema.parse({ name: 'a1', connectionId, provider, model })
    return { id: 'a1', config, soul: '', install: '', env: {}, resolved: await resolveConfiguredModel(config) }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
    await clearBoxDefault()
    await rm(connectionsDir(), { recursive: true, force: true })
    clearAgentCache()
    seq = 0
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
})

afterEach(() => {
    warn.mockRestore()
})

describe('automationModel', () => {
    it('runs what the automation asked for and stays quiet when it is usable', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const agent = await makeAgent(anthropic.id, 'anthropic', 'claude-sonnet-4-6')

        const using = await automationModel(agent, { slug: 'daily', connectionId: anthropic.id, model: 'claude-opus-4-8' }, 'schedule')

        expect(using).toEqual({ connectionId: anthropic.id, provider: 'anthropic', model: 'claude-opus-4-8' })
        expect(warn).not.toHaveBeenCalled()
    })

    it('runs the agent pair when the automation names no model, without a warning', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const agent = await makeAgent(anthropic.id, 'anthropic', 'claude-sonnet-4-6')

        const using = await automationModel(agent, { slug: 'inbound', connectionId: null, model: null }, 'trigger')

        expect(using).toEqual({ connectionId: anthropic.id, provider: 'anthropic', model: 'claude-sonnet-4-6' })
        expect(warn).not.toHaveBeenCalled()
    })

    it('reads a model with no connection against the agent connection', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const agent = await makeAgent(anthropic.id, 'anthropic', 'claude-sonnet-4-6')

        const using = await automationModel(agent, { slug: 'daily', connectionId: null, model: 'claude-opus-4-8' }, 'schedule')

        expect(using).toEqual({ connectionId: anthropic.id, provider: 'anthropic', model: 'claude-opus-4-8' })
        expect(warn).not.toHaveBeenCalled()
    })

    it('warns with what was asked and what runs instead when it falls back', async () => {
        await ensureMoldwrightConnection()
        const claude = await connect('claude', {})
        const agent = await makeAgent(claude.id, 'claude', 'opus')

        const using = await automationModel(agent, { slug: 'weekly', connectionId: claude.id, model: 'sonnet' }, 'schedule')

        expect(using).toEqual({ connectionId: RERUN_CONNECTION_ID, provider: 'rerun', model: RERUN_MODEL })
        expect(warn).toHaveBeenCalledWith(
            { agent: 'a1', source: 'schedule', slug: 'weekly', requested: `${claude.id}:sonnet`, using: `${RERUN_CONNECTION_ID}:${RERUN_MODEL}` },
            'connection unavailable, falling back',
        )
    })

    it('names a missing connection "none" in the warning', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const agent: LoadedAgent = { ...(await makeAgent(null, null, null)), resolved: { connection: null, provider: 'rerun', model: RERUN_MODEL } }

        const using = await automationModel(agent, { slug: 'hook', connectionId: null, model: null }, 'trigger')

        expect(using.connectionId).toBe(anthropic.id)
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ source: 'trigger', requested: `none:${RERUN_MODEL}`, using: `${anthropic.id}:${using.model}` }), 'connection unavailable, falling back')
    })
})
