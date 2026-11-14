import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Provider } from '@rerun/contracts'
import type { LoadedAgent } from '../agents/types.js'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-plan-'))

const { afterEach, describe, expect, it, vi } = await import('vitest')
const { readFile, rm, writeFile } = await import('node:fs/promises')
const { DEFAULT_CONNECTION_MODELS, agentConfigSchema } = await import('@rerun/contracts')
const { boxPlanPath, connectionsDir } = await import('../config/paths.js')
const { createConnection } = await import('./store.js')
const { allowedModel, readBoxPlan, writeBoxPlan } = await import('./plan.js')
const { forgetCliModels, recordCliModels } = await import('./cli-models.js')
const { defaultModelOf, resolveConfiguredModel, resolveRunModel } = await import('../agents/availability.js')

async function pinnedAgent(provider: Provider, model: string): Promise<LoadedAgent> {
    const connection = await createConnection({ name: provider, provider, models: DEFAULT_CONNECTION_MODELS[provider], extraModels: [], keys: {} })
    const config = agentConfigSchema.parse({ name: 'a1', connectionId: connection.id, provider, model })
    return { id: 'a1', config, soul: '', install: '', env: {}, resolved: await resolveConfiguredModel(config) }
}

afterEach(async () => {
    await writeBoxPlan({ premiumModels: true })
    await rm(connectionsDir(), { recursive: true, force: true })
})

describe('box plan storage', () => {
    it('runs everything on a box the hub never told', async () => {
        await rm(boxPlanPath(), { force: true })
        expect(readBoxPlan()).toEqual({ premiumModels: true })
    })

    it('round trips through the file', async () => {
        await writeBoxPlan({ premiumModels: false })
        expect(JSON.parse(await readFile(boxPlanPath(), 'utf8'))).toEqual({ premiumModels: false })
        expect(readBoxPlan()).toEqual({ premiumModels: false })
    })
})

describe('allowedModel', () => {
    it('leaves every model alone on a paid plan', () => {
        expect(allowedModel('claude', 'claude-opus-5-5')).toBe('claude-opus-5-5')
        expect(allowedModel('codex', 'gpt-6-astra')).toBe('gpt-6-astra')
    })

    it('steps a trial down to Sonnet and Sol, in the spelling of each provider', async () => {
        await writeBoxPlan({ premiumModels: false })
        expect(allowedModel('claude', 'claude-opus-5-5')).toBe('claude-sonnet-5-5')
        expect(allowedModel('claude', 'opus')).toBe('claude-sonnet-5-5')
        expect(allowedModel('anthropic', 'claude-fable-5-1')).toBe('claude-sonnet-5-5')
        expect(allowedModel('openrouter', 'anthropic/claude-opus-5.5')).toBe('anthropic/claude-sonnet-5.5')
        expect(allowedModel('openrouter', 'openai/gpt-6-astra')).toBe('openai/gpt-6-sol')
        expect(allowedModel('codex', 'gpt-6-astra')).toBe('gpt-6-sol')
        expect(allowedModel('codex', 'gpt-6-sol')).toBe('gpt-6-sol')
        expect(allowedModel('claude', 'claude-sonnet-5[1m]')).toBe('claude-sonnet-5[1m]')
    })
})

describe('model resolution on a trial box', () => {
    it('runs a pinned Opus agent on Sonnet without rewriting the pin', async () => {
        await writeBoxPlan({ premiumModels: false })
        const agent = await pinnedAgent('claude', 'claude-opus-5-5')
        expect(agent.resolved.model).toBe('claude-sonnet-5-5')
        expect(agent.config.model).toBe('claude-opus-5-5')
    })

    it('steps down a premium model asked for by a single run', async () => {
        await writeBoxPlan({ premiumModels: false })
        const agent = await pinnedAgent('codex', 'gpt-6-sol')
        expect((await resolveRunModel(agent, { model: 'gpt-6-astra' })).model).toBe('gpt-6-sol')
    })

    it('steps a run down in the spelling of the connection the override names', async () => {
        await writeBoxPlan({ premiumModels: false })
        const agent = await pinnedAgent('codex', 'gpt-6-sol')
        const claude = await createConnection({ name: 'claude', provider: 'claude', models: DEFAULT_CONNECTION_MODELS.claude, extraModels: [], keys: {} })
        const run = await resolveRunModel(agent, { connectionId: claude.id, model: 'claude-opus-5-5' })
        expect(run).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5' })
    })

    it('adopts the first model the plan runs as the connection default', async () => {
        const connection = await createConnection({ name: 'claude', provider: 'claude', models: DEFAULT_CONNECTION_MODELS.claude, extraModels: [], keys: {} })
        expect(defaultModelOf(connection)).toBe('claude-opus-5-5')
        await writeBoxPlan({ premiumModels: false })
        expect(defaultModelOf(connection)).toBe('claude-sonnet-5-5')
    })

    it('adopts the first model the subscription CLI serves, and any once it has no reading', async () => {
        const connection = await createConnection({ name: 'codex', provider: 'codex', models: ['gpt-6.1-sol', 'gpt-6-sol'], extraModels: [], keys: {} })
        recordCliModels(connection.id, ['gpt-6-sol', 'gpt-6-luna'], '0.156.1', true)
        expect(defaultModelOf(connection)).toBe('gpt-6-sol')
        forgetCliModels(connection.id)
        expect(defaultModelOf(connection)).toBe('gpt-6.1-sol')
    })

    it('keeps the first model as the Claude default whatever Claude Code lists', async () => {
        const connection = await createConnection({ name: 'claude', provider: 'claude', models: DEFAULT_CONNECTION_MODELS.claude, extraModels: [], keys: {} })
        recordCliModels(connection.id, ['claude-sonnet-5-5', 'claude-haiku-5-5'], '2.1.317', false)
        expect(defaultModelOf(connection)).toBe('claude-opus-5-5')
        forgetCliModels(connection.id)
    })

    it('reads a corrupt file as unrestricted', async () => {
        await writeBoxPlan({ premiumModels: false })
        await writeFile(boxPlanPath(), '{ not json', 'utf8')
        vi.resetModules()
        const fresh = await import('./plan.js')
        expect(fresh.readBoxPlan()).toEqual({ premiumModels: true })
    })
})
