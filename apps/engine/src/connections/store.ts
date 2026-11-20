import { mkdir, rm, writeFile, rename } from 'node:fs/promises'
import {
    PROVIDER_LABELS,
    RERUN_CONNECTION_ID,
    RERUN_MODEL,
    DEFAULT_CONNECTION_MODELS,
    connectionConfigSchema,
    type ConnectionConfig,
    type CreateConnectionInput,
    type UpdateConnectionInput,
    type UpdateConnectionKeysInput,
} from '@moldwright/contracts'
import { connectionConfigPath, connectionDir, connectionEnvPath, connectionsDir } from '../config/paths.js'
import { readEnvFile, serializeEnv, writeEnvFile } from '../lib/env-file.js'
import { badRequest } from '../lib/errors.js'
import { newId, nowIso } from '../lib/ids.js'
import { forgetCredentialRejected } from './credential-rejections.js'
import { connectionExists } from './loader.js'
import { withConnectionLock } from './lock.js'
import { forgetCliModels } from './cli-models.js'
import { forgetPlanLimits } from './plan-limits.js'
import { forgetOpencodePlanLimitsAttempt } from './opencode-plan-limits.js'
import { forgetClaudePlanLimitsAttempt } from './claude-plan-limits.js'
import { forgetCustomCatalog } from './custom-catalog.js'
import { forgetProviderCatalog } from './provider-catalog.js'
import { getConnection, reloadConnection, unloadConnection } from './registry.js'
import type { LoadedConnection } from './types.js'

async function writeConfig(id: string, config: ConnectionConfig): Promise<void> {
    const target = connectionConfigPath(id)
    const tmp = `${target}.tmp`
    await writeFile(tmp, `${JSON.stringify(config, null, 4)}\n`, 'utf8')
    await rename(tmp, target)
}

function assertCustomHasBaseUrl(config: ConnectionConfig): void {
    if (config.provider === 'custom' && !config.baseUrl) throw badRequest('A custom connection needs a base URL')
}

export async function createConnection(input: CreateConnectionInput, id = newId()): Promise<LoadedConnection> {
    const config = connectionConfigSchema.parse({
        name: input.name,
        provider: input.provider,
        models: input.models,
        baseUrl: input.baseUrl,
        extraModels: input.extraModels,
        contextWindow: input.contextWindow,
        vision: input.vision,
        createdAt: nowIso(),
    })
    assertCustomHasBaseUrl(config)
    serializeEnv(input.keys)
    await mkdir(connectionDir(id), { recursive: true, mode: 0o700 })
    await writeConfig(id, config)
    await writeEnvFile(connectionEnvPath(id), input.keys)
    return reloadConnection(id)
}

export async function patchConnection(id: string, patch: UpdateConnectionInput): Promise<LoadedConnection> {
    if (id === RERUN_CONNECTION_ID && patch.name !== undefined) throw badRequest('The Rerun connection cannot be renamed')
    if (id === RERUN_CONNECTION_ID && patch.models && !patch.models.includes(RERUN_MODEL)) throw badRequest('Rerun Balanced cannot be switched off')
    return withConnectionLock(id, async () => {
        const current = await getConnection(id)
        const next = connectionConfigSchema.parse({ ...current.config, ...patch })
        assertCustomHasBaseUrl(next)
        await writeConfig(id, next)
        if (next.baseUrl !== current.config.baseUrl) {
            forgetCustomCatalog(id)
            forgetProviderCatalog(id)
        }
        return reloadConnection(id)
    })
}

export async function updateConnectionKeys(id: string, { set, remove }: UpdateConnectionKeysInput): Promise<string[]> {
    if (id === RERUN_CONNECTION_ID) throw badRequest('The Rerun connection is keyless')
    return withConnectionLock(id, async () => {
        const path = connectionEnvPath(id)
        const next = await readEnvFile(path)
        for (const key of remove) delete next[key]
        for (const [key, value] of Object.entries(set)) next[key] = value
        await writeEnvFile(path, next)
        forgetPlanLimits(id)
        forgetCliModels(id)
        forgetOpencodePlanLimitsAttempt(id)
        forgetClaudePlanLimitsAttempt(id)
        forgetCustomCatalog(id)
        forgetProviderCatalog(id)
        forgetCredentialRejected(id)
        await reloadConnection(id)
        return Object.keys(next).sort()
    })
}

export function assertConnectionDeletable(id: string): void {
    if (id === RERUN_CONNECTION_ID) throw badRequest('The Rerun connection cannot be deleted')
}

export async function deleteConnection(id: string): Promise<void> {
    assertConnectionDeletable(id)
    unloadConnection(id)
    forgetPlanLimits(id)
    forgetCliModels(id)
    forgetOpencodePlanLimitsAttempt(id)
    forgetClaudePlanLimitsAttempt(id)
    forgetCustomCatalog(id)
    forgetProviderCatalog(id)
    forgetCredentialRejected(id)
    await rm(connectionDir(id), { recursive: true, force: true })
}

export async function ensureMoldwrightConnection(): Promise<void> {
    await mkdir(connectionsDir(), { recursive: true })
    if (connectionExists(RERUN_CONNECTION_ID)) {
        const { models } = (await getConnection(RERUN_CONNECTION_ID)).config
        const missing = DEFAULT_CONNECTION_MODELS.rerun.filter(id => !models.includes(id))
        if (missing.length === 0) return
        const head = missing.filter(id => id === RERUN_MODEL)
        const tail = missing.filter(id => id !== RERUN_MODEL)
        await patchConnection(RERUN_CONNECTION_ID, { models: [...head, ...models, ...tail] })
        return
    }
    await createConnection({ name: PROVIDER_LABELS.rerun, provider: 'rerun', models: DEFAULT_CONNECTION_MODELS.rerun, extraModels: [], keys: {} }, RERUN_CONNECTION_ID)
}
