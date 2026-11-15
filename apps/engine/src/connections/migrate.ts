import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { DEFAULT_CONNECTION_MODELS, PROVIDER_LABELS, canonicalModelId, canonicalModelIds, type Provider } from '@rerun/contracts'
import { agentDir, agentEnvPath, configPath, connectionDir, connectionsDir, connectionsMigratedPath } from '../config/paths.js'
import { listAgentIdsOnDisk } from '../agents/loader.js'
import { agentConfigSchema } from '../agents/types.js'
import { readEnvFile, writeEnvFile } from '../lib/env-file.js'
import { logger } from '../lib/logger.js'
import { nowIso } from '../lib/ids.js'
import { readBoxDefault, writeBoxDefault } from './default.js'
import { listConnectionIds, loadConnectionFromDisk } from './loader.js'
import { createConnection, ensureRerunConnection, patchConnection } from './store.js'
import type { LoadedConnection } from './types.js'

type LegacyAgentConfig = { name: string; provider: Provider; openrouterBaseUrl?: string; openrouterModels?: string[] }

const FOLD_PROVIDERS = ['rerun', 'anthropic', 'claude', 'codex', 'openai', 'google', 'openrouter'] as const satisfies readonly Provider[]
type FoldProvider = (typeof FOLD_PROVIDERS)[number]
const foldProviderSchema = z.enum(FOLD_PROVIDERS)

const FOLD_TOKEN_KEY: Record<FoldProvider, string> = {
    rerun: '',
    anthropic: 'ANTHROPIC_API_KEY',
    claude: 'CLAUDE_CODE_OAUTH_TOKEN',
    codex: 'CODEX_OAUTH_TOKEN',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
}

const FOLD_SATELLITE_KEYS: Record<FoldProvider, string[]> = {
    rerun: [],
    anthropic: [],
    claude: ['CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_EXPIRES_AT'],
    codex: ['CODEX_OAUTH_REFRESH_TOKEN', 'CODEX_OAUTH_ID_TOKEN', 'CODEX_OAUTH_ACCOUNT_ID', 'CODEX_OAUTH_EXPIRES_AT'],
    openai: [],
    google: ['GOOGLE_API_KEY'],
    openrouter: [],
}

const FOLD_ENV_KEYS: string[] = [...Object.values(FOLD_TOKEN_KEY).filter(Boolean), ...Object.values(FOLD_SATELLITE_KEYS).flat()]

const KEYED_PROVIDERS = FOLD_PROVIDERS.filter(p => !!FOLD_TOKEN_KEY[p])

function credentialOf(env: Record<string, string>, provider: FoldProvider): string | null {
    const primary = env[FOLD_TOKEN_KEY[provider]]
    if (primary) return primary
    for (const alias of FOLD_SATELLITE_KEYS[provider]) {
        if (alias.endsWith('_API_KEY') && env[alias]) return env[alias]
    }
    return null
}

function keysFor(env: Record<string, string>, provider: FoldProvider): Record<string, string> {
    const names = [FOLD_TOKEN_KEY[provider], ...FOLD_SATELLITE_KEYS[provider]]
    return Object.fromEntries(names.filter(name => env[name]).map(name => [name, env[name]]))
}

function fingerprint(provider: Provider, credential: string): string {
    return `${provider}::${credential}`
}

async function moveCodexHome(agentId: string, connectionId: string): Promise<void> {
    const from = resolve(agentDir(agentId), '.codex')
    if (!existsSync(from)) return
    const to = resolve(connectionDir(connectionId), '.codex')
    if (existsSync(to)) return
    await rename(from, to).catch(err => logger.warn({ agent: agentId, connection: connectionId, err: String(err) }, 'codex home move failed'))
}

async function renameAliasedModels(): Promise<void> {
    const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])
    for (const id of await listConnectionIds()) {
        const { config } = await loadConnectionFromDisk(id)
        const models = canonicalModelIds(config.models)
        const extraModels = canonicalModelIds(config.extraModels)
        if (sameIds(models, config.models) && sameIds(extraModels, config.extraModels)) continue
        await patchConnection(id, { models, extraModels })
        logger.info({ connection: id, models }, 'renamed aliased model ids on connection')
    }

    const boxDefault = await readBoxDefault()
    if (boxDefault && canonicalModelId(boxDefault.model) !== boxDefault.model) await writeBoxDefault({ ...boxDefault, model: canonicalModelId(boxDefault.model) })
}

export async function reconcileConnections(): Promise<void> {
    await mkdir(connectionsDir(), { recursive: true })
    await ensureRerunConnection()
    await renameAliasedModels()
}

export async function foldAgentKeysIntoConnections(): Promise<void> {
    await mkdir(connectionsDir(), { recursive: true })
    if (existsSync(connectionsMigratedPath())) return

    const agentIds = await listAgentIdsOnDisk()
    const byFingerprint = new Map<string, LoadedConnection>()
    let migratedAgents = 0

    for (const agentId of agentIds) {
        const env = await readEnvFile(agentEnvPath(agentId))
        const raw = JSON.parse(await readFile(configPath(agentId), 'utf8')) as LegacyAgentConfig
        const agentProvider = foldProviderSchema.catch('rerun').parse(raw.provider)

        for (const provider of KEYED_PROVIDERS) {
            const credential = credentialOf(env, provider)
            if (!credential) continue
            const key = fingerprint(provider, credential)
            if (byFingerprint.has(key)) continue

            const connection = await createConnection({
                name: `${PROVIDER_LABELS[provider]} (${raw.name})`,
                provider,
                models: DEFAULT_CONNECTION_MODELS[provider],
                baseUrl: provider === 'openrouter' ? (raw.openrouterBaseUrl ?? '') : undefined,
                extraModels: provider === 'openrouter' ? (raw.openrouterModels ?? []) : [],
                keys: keysFor(env, provider),
            })
            byFingerprint.set(key, connection)
            if (provider === 'codex') await moveCodexHome(agentId, connection.id)
        }

        const credential = credentialOf(env, agentProvider)
        const own = credential ? byFingerprint.get(fingerprint(agentProvider, credential)) : undefined

        const next = agentConfigSchema.parse({ ...raw, connectionId: own?.id ?? null })
        await writeFile(configPath(agentId), `${JSON.stringify(next, null, 4)}\n`, { encoding: 'utf8', mode: 0o600 })

        const remaining = Object.fromEntries(Object.entries(env).filter(([name]) => !FOLD_ENV_KEYS.includes(name)))
        if (Object.keys(remaining).length !== Object.keys(env).length) await writeEnvFile(agentEnvPath(agentId), remaining)
        migratedAgents += 1
    }

    await writeFile(connectionsMigratedPath(), `${nowIso()}\n`, 'utf8')
    logger.info({ agents: migratedAgents, connections: byFingerprint.size }, 'migrated agent provider keys into box connections')
}
