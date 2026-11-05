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

// The agent config as it was before connections existed: the two OpenRouter overrides moved onto
// the connection, so the current schema no longer describes what is on disk here.
type LegacyAgentConfig = { name: string; provider: Provider; openrouterBaseUrl?: string; openrouterModels?: string[] }

// The providers and their key names as they stood when this step shipped. It is a step of the
// data-dir ladder, so a data-dir restored long after must be folded exactly as it would have been
// then: a provider added since (OpenCode) is neither folded into a connection nor stripped from an
// agent's `.env`, where it can only be a shell variable of the user's.
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
    // Google is the one provider the engine reads under two names, so a key stored only under the
    // alias still describes a real connection.
    for (const alias of FOLD_SATELLITE_KEYS[provider]) {
        if (alias.endsWith('_API_KEY') && env[alias]) return env[alias]
    }
    return null
}

function keysFor(env: Record<string, string>, provider: FoldProvider): Record<string, string> {
    const names = [FOLD_TOKEN_KEY[provider], ...FOLD_SATELLITE_KEYS[provider]]
    return Object.fromEntries(names.filter(name => env[name]).map(name => [name, env[name]]))
}

// Two agents holding the same token are two copies of one subscription, not two connections. The
// credential value is the identity; the provider disambiguates the (unlikely) collision.
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

// Rerun Balanced is an alias now, and the id it used to be stays written in the connection of every box
// curated before it. Reading it under its current name is what keeps the model picker showing one
// Max instead of two. Runs on every boot rather than as a ladder step: the fold is a one-off, a
// rename is whatever the ids happen to be today.
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

    // The box default names a pair, and a default left on the old spelling no longer matches any
    // row: every agent following the box would drop through the ladder instead of reading it.
    const boxDefault = await readBoxDefault()
    if (boxDefault && canonicalModelId(boxDefault.model) !== boxDefault.model) await writeBoxDefault({ ...boxDefault, model: canonicalModelId(boxDefault.model) })
}

// Brings the connections in line with today's code on every boot, after the migration ladder:
// these are not steps in the data-dir's history but whatever the current ids and rules happen to be.
export async function reconcileConnections(): Promise<void> {
    await mkdir(connectionsDir(), { recursive: true })
    await ensureRerunConnection()
    await renameAliasedModels()
}

// Folds every agent's provider credentials into box-level connections, once. Part of the data-dir
// ladder's baseline step, and still gated by its own marker file so a box that folded before the
// ladder existed does nothing; an engine that restarts mid-way is safe to resume only because each
// step below is itself re-runnable.
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
