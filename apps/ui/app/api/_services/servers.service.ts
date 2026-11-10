import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

import type { Database } from '@/app/api/database.types'
import { attachCustomEngine, findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { buildBaseUrl } from '@/lib/engine/base-url'
import { getEngineHealth, listConnections } from '@/lib/engine/client'
import type { EngineHealth } from '@/lib/engine/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError, type ErrorCode, type ErrorParams } from '@/lib/i18n/action-error'

// The servers of a self-hosted install: an engine somebody runs on a machine of their own, attached
// to one workspace. The pool of Rerun Cloud never shows here (see SERVERS_ENABLED).

export const PAIRING_TOKEN_PREFIX = 'rrn_pair_'
const PAIRING_TTL_MS = 15 * 60_000

type TokenUpdate = Database['public']['Tables']['engine_pairing_tokens']['Update']

export class ServerPairingError extends AppError {
    constructor(
        code: ErrorCode,
        readonly status: number,
        params?: ErrorParams,
    ) {
        super(code, params)
        this.name = 'ServerPairingError'
    }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createPairingToken(workspaceId: number, userId: string): Promise<{ token: string; expiresAt: string }> {
    const token = `${PAIRING_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
    const { error } = await createServiceRoleClient()
        .from('engine_pairing_tokens')
        .insert<Database['public']['Tables']['engine_pairing_tokens']['Insert']>({ workspace_id: workspaceId, token_hash: hashToken(token), created_by: userId, expires_at: expiresAt })
    if (error) throw new Error(error.message)
    return { token, expiresAt }
}

// Reaches the engine the way the app will from now on: /health answers without a key, and the key is
// proven on a call that needs it. Said in words a person in front of their terminal can act on.
async function checkReachable(baseUrl: string, apiKey: string): Promise<EngineHealth> {
    const conn = { baseUrl, apiKey }
    let health: EngineHealth
    try {
        health = await getEngineHealth(conn)
    } catch {
        throw new ServerPairingError('serverUnreachable', 422, { url: baseUrl })
    }
    try {
        await listConnections(conn, { signal: AbortSignal.timeout(5000) })
    } catch {
        throw new ServerPairingError('serverRefusedKey', 422, { url: baseUrl })
    }
    return health
}

// The address an engine is reached at: what it says when it says one, else where its request came
// from on the engine's default port.
export function engineAddress(advertised: string | null | undefined, callerIp: string | null): string | null {
    if (advertised?.trim()) return buildBaseUrl(advertised)
    if (!callerIp) return null
    const host = callerIp.includes(':') && !callerIp.startsWith('[') ? `[${callerIp}]` : callerIp
    return buildBaseUrl(host)
}

export async function redeemPairingToken(input: { token: string; url: string | null; apiKey: string }): Promise<{ workspaceId: number }> {
    if (!input.token.startsWith(PAIRING_TOKEN_PREFIX)) throw new ServerPairingError('pairingTokenInvalid', 401)
    if (!input.apiKey) throw new ServerPairingError('serverSentNoKey', 400)
    if (!input.url) throw new ServerPairingError('serverSentNoUrl', 400)

    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'engine_pairing_tokens', ['id', 'workspace_id', 'expires_at', 'used_at'] as const, { token_hash: hashToken(input.token) })
    if (!row || row.used_at) throw new ServerPairingError('pairingTokenUnusable', 401)
    if (Date.parse(row.expires_at) < Date.now()) throw new ServerPairingError('pairingTokenExpired', 401)
    if (await findWorkspaceEngine(row.workspace_id)) throw new ServerPairingError('workspaceHasServerRemoveFirst', 409)

    await checkReachable(input.url, input.apiKey)

    // The token is spent before the engine is attached, so two servers racing on one token attach once.
    const { data: claimed, error } = await supabase
        .from('engine_pairing_tokens')
        .update<TokenUpdate>({ used_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('used_at', null)
        .select('id')
    if (error) throw new Error(error.message)
    if (!claimed?.length) throw new ServerPairingError('pairingTokenUsed', 401)

    await attachCustomEngine(row.workspace_id, { engineHost: input.url, engineApiKey: input.apiKey })
    return { workspaceId: row.workspace_id }
}

export async function attachServerManually(workspaceId: number, input: { url: string; apiKey: string }): Promise<void> {
    if (await findWorkspaceEngine(workspaceId)) throw new ServerPairingError('workspaceHasServer', 409)
    const baseUrl = buildBaseUrl(input.url)
    await checkReachable(baseUrl, input.apiKey.trim())
    await attachCustomEngine(workspaceId, { engineHost: baseUrl, engineApiKey: input.apiKey.trim() })
}

export type WorkspaceServer = {
    address: string
    // False for a machine of Rerun Cloud's pool, which cannot be removed from here.
    removable: boolean
    health: { reachable: true; commit: string | null; activeAgents: number; startedAt: string | null } | { reachable: false }
}

export async function readWorkspaceServer(workspaceId: number): Promise<WorkspaceServer | null> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return null
    const health = await getEngineHealth(engine.conn).catch(() => null)
    return {
        address: engine.conn.baseUrl,
        removable: !engine.managed,
        health: health ? { reachable: true, commit: health.commit ?? null, activeAgents: health.activeAgents, startedAt: health.startedAt ?? null } : { reachable: false },
    }
}

// Detaches a server somebody else hosts. Its data-dir stays on it: attaching it again brings every
// coworker back.
export async function detachWorkspaceServer(workspaceId: number): Promise<void> {
    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return
    if (engine.managed) throw new ServerPairingError('machineBelongsToCloud', 403)
    const { error } = await createServiceRoleClient().from('engine_pool').delete().eq('id', engine.instanceId)
    if (error) throw new Error(error.message)
}
