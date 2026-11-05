import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cxmigrate-'))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { RERUN_CONNECTION_ID } = await import('@rerun/contracts')
const { agentDir, agentEnvPath, codexAuthPath, configPath, connectionConfigPath, connectionDir, connectionsDir, connectionsMigratedPath } = await import('../config/paths.js')
const { readEnvFile, writeEnvFile } = await import('../lib/env-file.js')
const { foldAgentKeysIntoConnections, reconcileConnections } = await import('./migrate.js')
const { listConnections, unloadConnection } = await import('./registry.js')
const { toSummary, loadConnectionFromDisk } = await import('./loader.js')
const { readBoxDefault, writeBoxDefault } = await import('./default.js')
const { agentsDir } = await import('../config/paths.js')

const CLAUDE_TOKEN = 'sk-ant-oat-shared-by-two-agents'

async function seedAgent(id: string, config: Record<string, unknown>, env: Record<string, string>) {
    await mkdir(agentDir(id), { recursive: true })
    await writeFile(configPath(id), JSON.stringify({ name: id, description: '', model: 'sonnet', tools: {}, mcpServers: [], selfImprovement: {}, ...config }, null, 4), 'utf8')
    await writeEnvFile(agentEnvPath(id), env)
}

async function readConfig(id: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(configPath(id), 'utf8')) as Record<string, unknown>
}

async function connections() {
    return (await listConnections()).filter(c => c.id !== RERUN_CONNECTION_ID).map(toSummary)
}

async function migrateConnections() {
    await foldAgentKeysIntoConnections()
    await reconcileConnections()
}

beforeEach(async () => {
    for (const id of ['alpha', 'beta', 'gamma', RERUN_CONNECTION_ID]) unloadConnection(id)
    await rm(connectionsDir(), { recursive: true, force: true })
    await rm(agentsDir(), { recursive: true, force: true })
})

describe('migrateConnections', () => {
    it('folds two agents sharing a subscription into one connection', async () => {
        await seedAgent('alpha', { provider: 'claude' }, { CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN, CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'r1' })
        await seedAgent('beta', { provider: 'claude' }, { CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN, CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'r1' })

        await migrateConnections()

        const created = await connections()
        expect(created).toHaveLength(1)
        expect(created[0].provider).toBe('claude')
        expect((await readConfig('alpha')).connectionId).toBe(created[0].id)
        expect((await readConfig('beta')).connectionId).toBe(created[0].id)
    })

    it('keeps two different credentials as two connections', async () => {
        await seedAgent('alpha', { provider: 'claude' }, { CLAUDE_CODE_OAUTH_TOKEN: 'token-one' })
        await seedAgent('beta', { provider: 'claude' }, { CLAUDE_CODE_OAUTH_TOKEN: 'token-two' })

        await migrateConnections()

        const created = await connections()
        expect(created).toHaveLength(2)
        expect((await readConfig('alpha')).connectionId).not.toBe((await readConfig('beta')).connectionId)
    })

    // The whole point of the migration: an agent's .env keeps everything that is not a provider
    // credential, because MCP servers, the shell tool and the connectors all read it.
    it('strips only the provider keys from the agent env', async () => {
        await seedAgent('alpha', { provider: 'anthropic' }, { ANTHROPIC_API_KEY: 'k', STRIPE_API_KEY: 'sk_test_x', MY_VAR: 'hello' })

        await migrateConnections()

        expect(await readEnvFile(agentEnvPath('alpha'))).toEqual({ STRIPE_API_KEY: 'sk_test_x', MY_VAR: 'hello' })
    })

    // The fold shipped before OpenCode existed: on a v0 data-dir, an OPENCODE_API_KEY in an agent's
    // .env can only be a variable of the user's shell, and it stays where it is.
    it('leaves a provider added after the fold alone', async () => {
        await seedAgent('alpha', { provider: 'opencode' }, { OPENCODE_API_KEY: 'oc_sk_shell', MY_VAR: 'hello' })

        await migrateConnections()

        expect(await connections()).toHaveLength(0)
        expect(await readEnvFile(agentEnvPath('alpha'))).toEqual({ OPENCODE_API_KEY: 'oc_sk_shell', MY_VAR: 'hello' })
        expect((await readConfig('alpha')).connectionId).toBeNull()
    })

    it('carries the OpenRouter overrides onto the connection', async () => {
        await seedAgent(
            'alpha',
            { provider: 'openrouter', openrouterBaseUrl: 'https://router.example.com/v1', openrouterModels: ['acme/router-large'] },
            { OPENROUTER_API_KEY: 'k' },
        )

        await migrateConnections()

        const [created] = await connections()
        expect(created.baseUrl).toBe('https://router.example.com/v1')
        expect(created.extraModels).toEqual(['acme/router-large'])
        const config = await readConfig('alpha')
        expect(config.openrouterBaseUrl).toBeUndefined()
        expect(config.openrouterModels).toBeUndefined()
    })

    it('moves the codex home under its connection', async () => {
        await seedAgent('alpha', { provider: 'codex' }, { CODEX_OAUTH_TOKEN: 't' })
        await mkdir(resolve(agentDir('alpha'), '.codex'), { recursive: true })
        await writeFile(resolve(agentDir('alpha'), '.codex', 'auth.json'), '{"tokens":{}}', 'utf8')

        await migrateConnections()

        const [created] = await connections()
        expect(await readFile(codexAuthPath(created.id), 'utf8')).toBe('{"tokens":{}}')
    })

    // An agent whose credential was never set has nothing to point at, and must not silently
    // inherit another agent's subscription.
    it('leaves an agent with no credential unattached', async () => {
        await seedAgent('alpha', { provider: 'claude' }, { CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN })
        await seedAgent('gamma', { provider: 'anthropic' }, {})

        await migrateConnections()

        expect((await readConfig('gamma')).connectionId).toBeNull()
    })

    it('does nothing on a second run', async () => {
        await seedAgent('alpha', { provider: 'claude' }, { CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN })
        await migrateConnections()
        const first = await connections()

        await migrateConnections()

        expect(await connections()).toHaveLength(first.length)
        expect((await readConfig('alpha')).connectionId).toBe(first[0].id)
    })

    // Rerun Balanced used to be stored as the OpenRouter id it ran on. Left as it is, the
    // connections tab lists it next to the current id as a second row spelled "Balanced".
    it('renames the id Rerun Balanced was stored under, and the box default naming it', async () => {
        await mkdir(connectionDir(RERUN_CONNECTION_ID), { recursive: true })
        const legacy = { name: 'Rerun', provider: 'rerun', models: ['qwen/qwen3.7-max'], extraModels: [], createdAt: '2026-01-01T00:00:00.000Z' }
        await writeFile(connectionConfigPath(RERUN_CONNECTION_ID), JSON.stringify(legacy, null, 4), 'utf8')
        await writeBoxDefault({ connectionId: RERUN_CONNECTION_ID, model: 'qwen/qwen3.7-max' })

        await migrateConnections()

        expect((await loadConnectionFromDisk(RERUN_CONNECTION_ID)).config.models).toEqual(['rerun-max', 'rerun-fast', 'rerun-smart'])
        expect(await readBoxDefault()).toEqual({ connectionId: RERUN_CONNECTION_ID, model: 'rerun-max' })
    })

    it('provisions the keyless Rerun connection', async () => {
        await migrateConnections()
        expect((await listConnections()).some(c => c.id === RERUN_CONNECTION_ID)).toBe(true)
        expect(await readFile(connectionsMigratedPath(), 'utf8')).toMatch(/\d{4}-\d{2}-\d{2}T/)
    })
})
