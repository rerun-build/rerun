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
} from '@rerun/contracts'
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
import { getConnection, reloadConnection, unloadConnection } from './registry.js'
import type { LoadedConnection } from './types.js'

async function writeConfig(id: string, config: ConnectionConfig): Promise<void> {
    const target = connectionConfigPath(id)
    const tmp = `${target}.tmp`
    await writeFile(tmp, `${JSON.stringify(config, null, 4)}\n`, 'utf8')
    await rename(tmp, target)
}

export async function createConnection(input: CreateConnectionInput, id = newId()): Promise<LoadedConnection> {
    const config = connectionConfigSchema.parse({
        name: input.name,
        provider: input.provider,
        models: input.models,
        baseUrl: input.baseUrl,
        extraModels: input.extraModels,
        createdAt: nowIso(),
    })
    // Refused keys must fail before the folder exists, or the box lists a connection nobody created.
    serializeEnv(input.keys)
    await mkdir(connectionDir(id), { recursive: true, mode: 0o700 })
    await writeConfig(id, config)
    await writeEnvFile(connectionEnvPath(id), input.keys)
    return reloadConnection(id)
}

export async function patchConnection(id: string, patch: UpdateConnectionInput): Promise<LoadedConnection> {
    if (id === RERUN_CONNECTION_ID && patch.name !== undefined) throw badRequest('The Rerun connection cannot be renamed')
    // Rerun Balanced is the one model a box always has, so switching every model off can never
    // leave it with nothing to run on.
    if (id === RERUN_CONNECTION_ID && patch.models && !patch.models.includes(RERUN_MODEL)) throw badRequest('Rerun Balanced cannot be switched off')
    return withConnectionLock(id, async () => {
        const current = await getConnection(id)
        const next = connectionConfigSchema.parse({ ...current.config, ...patch })
        await writeConfig(id, next)
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
        // New keys can be another account altogether, and its plan stands somewhere else.
        forgetPlanLimits(id)
        forgetCliModels(id)
        forgetOpencodePlanLimitsAttempt(id)
        forgetCredentialRejected(id)
        await reloadConnection(id)
        return Object.keys(next).sort()
    })
}

// Exported because a delete releases everything pointing at the connection before it removes it,
// and detaching a fleet of agents only to refuse the delete afterwards would be worse than either.
export function assertConnectionDeletable(id: string): void {
    if (id === RERUN_CONNECTION_ID) throw badRequest('The Rerun connection cannot be deleted')
}

export async function deleteConnection(id: string): Promise<void> {
    assertConnectionDeletable(id)
    unloadConnection(id)
    forgetPlanLimits(id)
    forgetCliModels(id)
    forgetOpencodePlanLimitsAttempt(id)
    forgetCredentialRejected(id)
    await rm(connectionDir(id), { recursive: true, force: true })
}

// The keyless connection every box carries. Provisioned on boot rather than special-cased at read
// time, so it lists, patches and resolves through exactly the same paths as any other.
export async function ensureRerunConnection(): Promise<void> {
    await mkdir(connectionsDir(), { recursive: true })
    if (connectionExists(RERUN_CONNECTION_ID)) {
        // Boxes provisioned when Rerun had a single model, and those where it was switched off
        // before it became mandatory. Balanced goes first, the tiers that came later go last, so
        // what the connection runs when no model is named does not move.
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
