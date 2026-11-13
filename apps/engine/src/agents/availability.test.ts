import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Provider } from '@rerun/contracts'
import type { LoadedAgent } from './types.js'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-availability-'))
// `env()` caches on first call, and the first call happens while the imports below run, so the hub
// credentials the keyless Rerun connection is judged on have to be in place before them.
process.env.RERUN_HUB_BASE_URL = 'https://hub.example.com'
process.env.RERUN_API_KEY = 'hub-key'

const { beforeEach, describe, expect, it } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { DEFAULT_CONNECTION_MODELS, RERUN_CONNECTION_ID, RERUN_MODEL, agentConfigSchema } = await import('@rerun/contracts')
const { connectionsDir } = await import('../config/paths.js')
const { createConnection, ensureRerunConnection } = await import('../connections/store.js')
const { getConnection } = await import('../connections/registry.js')
const { clearAgentCache } = await import('./registry.js')
const { clearBoxDefault, readBoxDefault, writeBoxDefault } = await import('../connections/default.js')
const { forgetCliModels, recordCliModels, recordRefusedModel } = await import('../connections/cli-models.js')
const { boxDefaultModel, defaultModelOf, isUsable, repairBoxDefault, resolveAutomationModel, resolveConfiguredModel, resolveRunModel } = await import('./availability.js')

let seq = 0

async function connect(provider: Provider, keys: Record<string, string>, models = DEFAULT_CONNECTION_MODELS[provider]) {
    seq += 1
    return createConnection({ name: `${provider}-${seq}`, provider, models, extraModels: [], keys })
}

async function makeAgent(connectionId: string | null, provider: Provider | null, model: string | null): Promise<LoadedAgent> {
    const config = agentConfigSchema.parse({ name: 'a1', connectionId, provider, model })
    return { id: 'a1', config, soul: '', install: '', env: {}, resolved: await resolveConfiguredModel(config) }
}

// An agent that picked nothing: the state a freshly created one starts in.
function boxDefaultAgent(): Promise<LoadedAgent> {
    return makeAgent(null, null, null)
}

// Each test starts from a bare box. `ensureRerunConnection` is called explicitly rather than here,
// so a test can describe a box that has no keyless fallback at all.
beforeEach(async () => {
    await clearBoxDefault()
    await rm(connectionsDir(), { recursive: true, force: true })
    clearAgentCache()
    seq = 0
})

describe('isUsable', () => {
    it('needs both a credential and the model on the connection', async () => {
        const withKey = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        expect(isUsable(withKey, 'claude-opus-4-8')).toBe(true)
        expect(isUsable(withKey, 'gpt-4o')).toBe(false)

        const withoutKey = await connect('anthropic', {})
        expect(isUsable(withoutKey, 'claude-opus-4-8')).toBe(false)
    })

    it('accepts a model the catalog does not know but the connection advertises', async () => {
        const connection = await createConnection({ name: 'custom router', provider: 'openrouter', models: [], extraModels: ['acme/router-large'], keys: { OPENROUTER_API_KEY: 'k' } })
        expect(isUsable(connection, 'acme/router-large')).toBe(true)
    })

    it('reads the keyless Rerun connection off the hub configuration', async () => {
        await ensureRerunConnection()
        expect(isUsable(await getConnection(RERUN_CONNECTION_ID), RERUN_MODEL)).toBe(true)
    })

    it('is false for an agent with no connection at all', () => {
        expect(isUsable(null, RERUN_MODEL)).toBe(false)
    })
})

describe('resolveAutomationModel', () => {
    it('leaves an available request untouched', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const agent = await makeAgent(anthropic.id, 'anthropic', 'claude-sonnet-4-6')
        expect(await resolveAutomationModel(agent, { connectionId: anthropic.id, model: 'claude-opus-4-8' })).toEqual({
            connectionId: anthropic.id,
            provider: 'anthropic',
            model: 'claude-opus-4-8',
        })
    })

    it('falls back to the agent default when the requested connection lost its credential', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const claude = await connect('claude', {})
        const agent = await makeAgent(anthropic.id, 'anthropic', 'claude-opus-4-8')
        expect(await resolveAutomationModel(agent, { connectionId: claude.id, model: 'opus' })).toEqual({
            connectionId: anthropic.id,
            provider: 'anthropic',
            model: 'claude-opus-4-8',
        })
    })

    it('falls back to Rerun before any other connection', async () => {
        await ensureRerunConnection()
        await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const claude = await connect('claude', {})
        const agent = await makeAgent(claude.id, 'claude', 'opus')
        expect(await resolveAutomationModel(agent, undefined)).toEqual({ connectionId: RERUN_CONNECTION_ID, provider: 'rerun', model: RERUN_MODEL })
    })

    it('falls back to any connected connection when the box has no Rerun one', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const claude = await connect('claude', {})
        const agent = await makeAgent(claude.id, 'claude', 'opus')
        expect(await resolveAutomationModel(agent, undefined)).toEqual({
            connectionId: anthropic.id,
            provider: 'anthropic',
            model: DEFAULT_CONNECTION_MODELS.anthropic[0],
        })
    })

    it('rejects a model the connection was curated to exclude', async () => {
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' }, ['claude-sonnet-4-6'])
        const agent = await makeAgent(anthropic.id, 'anthropic', 'claude-sonnet-4-6')
        expect(await resolveAutomationModel(agent, { connectionId: anthropic.id, model: 'claude-opus-4-8' })).toEqual({
            connectionId: anthropic.id,
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
        })
    })

    it('keeps failing as before when nothing on the box is usable', async () => {
        const claude = await connect('claude', {})
        const agent = await makeAgent(claude.id, 'claude', 'opus')
        expect(await resolveAutomationModel(agent, undefined)).toEqual({ connectionId: claude.id, provider: 'claude', model: 'opus' })
    })
})

describe('boxDefaultModel', () => {
    it('answers what the owner set', async () => {
        await ensureRerunConnection()
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        await writeBoxDefault({ connectionId: anthropic.id, model: 'claude-opus-4-8' })
        expect(await boxDefaultModel()).toMatchObject({ provider: 'anthropic', model: 'claude-opus-4-8' })
    })

    it('skips a default whose credential is gone', async () => {
        await ensureRerunConnection()
        const claude = await connect('claude', {})
        await writeBoxDefault({ connectionId: claude.id, model: 'opus' })
        expect(await boxDefaultModel()).toMatchObject({ provider: 'rerun', model: RERUN_MODEL })
    })

    it('skips a default naming a model the connection no longer offers', async () => {
        await ensureRerunConnection()
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' }, ['claude-sonnet-4-6'])
        await writeBoxDefault({ connectionId: anthropic.id, model: 'claude-opus-4-8' })
        expect(await boxDefaultModel()).toMatchObject({ provider: 'rerun', model: RERUN_MODEL })
    })

    it('falls back to Rerun when nothing was ever set', async () => {
        await ensureRerunConnection()
        expect(await boxDefaultModel()).toMatchObject({ provider: 'rerun', model: RERUN_MODEL })
    })

    it('reads exactly like the old hardcoded defaults on a box with nothing plugged in', async () => {
        expect(await boxDefaultModel()).toEqual({ connection: null, provider: 'rerun', model: RERUN_MODEL })
    })
})

describe('resolveConfiguredModel', () => {
    it('follows the box default when the agent named no model', async () => {
        await ensureRerunConnection()
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        await writeBoxDefault({ connectionId: anthropic.id, model: 'claude-opus-4-8' })
        expect(await resolveConfiguredModel((await boxDefaultAgent()).config)).toMatchObject({ provider: 'anthropic', model: 'claude-opus-4-8' })
    })

    it('ignores a leftover connectionId sitting next to a null model', async () => {
        await ensureRerunConnection()
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        const stale = await connect('claude', { CLAUDE_CODE_OAUTH_TOKEN: 't' })
        await writeBoxDefault({ connectionId: anthropic.id, model: 'claude-opus-4-8' })
        const config = agentConfigSchema.parse({ name: 'a1', connectionId: stale.id, provider: 'claude', model: null })
        expect(await resolveConfiguredModel(config)).toMatchObject({ provider: 'anthropic', model: 'claude-opus-4-8' })
    })

    it('returns a pin as asked even when its credential was pulled, rather than swapping it', async () => {
        await ensureRerunConnection()
        const claude = await connect('claude', {})
        expect(await resolveConfiguredModel((await makeAgent(claude.id, 'claude', 'opus')).config)).toMatchObject({ connection: claude, provider: 'claude', model: 'opus' })
    })

    it('still maps a bare provider onto the oldest connection of that provider', async () => {
        const first = await connect('anthropic', { ANTHROPIC_API_KEY: 'k1' })
        await connect('anthropic', { ANTHROPIC_API_KEY: 'k2' })
        const resolved = await resolveConfiguredModel(agentConfigSchema.parse({ name: 'a1', provider: 'anthropic', model: 'claude-opus-4-8' }))
        expect(resolved.connection?.id).toBe(first.id)
    })
})

describe('resolveRunModel', () => {
    // The hub names a connection and a model in a chat, never a provider.
    it('runs an override on the provider of the connection it names, not on the agent\'s', async () => {
        const codex = await connect('codex', { CODEX_OAUTH_TOKEN: 't' })
        const claude = await connect('claude', { CLAUDE_CODE_OAUTH_TOKEN: 't' })
        const agent = await makeAgent(codex.id, 'codex', 'gpt-6-sol')
        expect(await resolveRunModel(agent, { connectionId: claude.id, model: 'claude-opus-5-5' })).toMatchObject({ connection: { id: claude.id }, provider: 'claude', model: 'claude-opus-5-5' })
    })
})

describe('resolveAutomationModel over a box-default agent', () => {
    it('runs the box default when the automation names no model of its own', async () => {
        await ensureRerunConnection()
        const anthropic = await connect('anthropic', { ANTHROPIC_API_KEY: 'k' })
        await writeBoxDefault({ connectionId: anthropic.id, model: 'claude-opus-4-8' })
        expect(await resolveAutomationModel(await boxDefaultAgent(), undefined)).toEqual({ connectionId: anthropic.id, provider: 'anthropic', model: 'claude-opus-4-8' })
    })
})

// What a ChatGPT account without the Sol models answers to Codex's `model/list`, read on a real box.
const CHATGPT_PLAN_MODELS = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna']

async function chatgpt(served: string[] | null = CHATGPT_PLAN_MODELS) {
    const connection = await connect('codex', { CODEX_OAUTH_TOKEN: 't' })
    forgetCliModels(connection.id)
    if (served) recordCliModels(connection.id, served, '0.166.0', false)
    return connection
}

describe('a ChatGPT plan that leaves models out', () => {
    it('defaults to the first model the account serves', async () => {
        expect(defaultModelOf(await chatgpt())).toBe('gpt-6-luna')
    })

    it('defaults to the first model of the list while the account has not been read', async () => {
        expect(defaultModelOf(await chatgpt(null))).toBe(DEFAULT_CONNECTION_MODELS.codex[0])
    })

    it('does not count a model the account refuses as usable', async () => {
        const codex = await chatgpt()
        expect(isUsable(codex, 'gpt-6-sol')).toBe(false)
        expect(isUsable(codex, 'gpt-6-luna')).toBe(true)
    })

    it('runs a refused stored default on a served model of the same connection, not on Rerun', async () => {
        await ensureRerunConnection()
        const codex = await chatgpt()
        await writeBoxDefault({ connectionId: codex.id, model: 'gpt-6-sol' })
        expect(await boxDefaultModel()).toMatchObject({ connection: { id: codex.id }, provider: 'codex', model: 'gpt-6-luna' })
    })

    it('moves a refused stored default to a served model', async () => {
        const codex = await chatgpt()
        await writeBoxDefault({ connectionId: codex.id, model: 'gpt-6-sol' })
        await repairBoxDefault(codex)
        expect(await readBoxDefault()).toEqual({ connectionId: codex.id, model: 'gpt-6-luna' })
    })

    it('leaves a served default, another connection, and a connection never read alone', async () => {
        const read = await chatgpt()
        await writeBoxDefault({ connectionId: read.id, model: 'gpt-5.6-terra' })
        await repairBoxDefault(read)
        expect(await readBoxDefault()).toEqual({ connectionId: read.id, model: 'gpt-5.6-terra' })

        const unread = await chatgpt(null)
        await writeBoxDefault({ connectionId: unread.id, model: 'gpt-6-sol' })
        await repairBoxDefault(read)
        await repairBoxDefault(unread)
        expect(await readBoxDefault()).toEqual({ connectionId: unread.id, model: 'gpt-6-sol' })
    })

    it('stops serving a model a run was refused on, though the list announced it', async () => {
        const codex = await chatgpt(DEFAULT_CONNECTION_MODELS.codex)
        await writeBoxDefault({ connectionId: codex.id, model: 'gpt-6-sol' })
        recordRefusedModel(codex.id, 'gpt-6-sol')
        await repairBoxDefault(codex)
        expect(await readBoxDefault()).toEqual({ connectionId: codex.id, model: 'gpt-6.1-sol' })
    })

    it('falls an automation back off a refused model, but keeps a pin as asked', async () => {
        const codex = await chatgpt()
        await writeBoxDefault({ connectionId: codex.id, model: 'gpt-6-luna' })
        const pinned = await makeAgent(codex.id, 'codex', 'gpt-6-sol')
        expect(pinned.resolved).toMatchObject({ provider: 'codex', model: 'gpt-6-sol' })
        expect(await resolveAutomationModel(pinned, { connectionId: codex.id, model: 'gpt-6-sol' })).toEqual({ connectionId: codex.id, provider: 'codex', model: 'gpt-6-luna' })
    })
})

describe('a Claude subscription', () => {
    it('keeps the first model as its default whatever Claude Code lists', async () => {
        const claude = await connect('claude', { CLAUDE_CODE_OAUTH_TOKEN: 't' })
        recordCliModels(claude.id, ['claude-sonnet-5-5', 'claude-haiku-5-5'], '2.1.317', false)
        expect(defaultModelOf(claude)).toBe('claude-opus-5-5')
        forgetCliModels(claude.id)
    })
})
