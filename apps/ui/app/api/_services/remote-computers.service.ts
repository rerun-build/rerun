import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

import { REMOTE_COMPUTER_TOKEN_PREFIX, REMOTE_WS_PATH, computerHandleOf, remoteHandleFromName, type RemoteComputerIdentity, type RemoteComputerRule, type RemoteComputerSettingsPatch, type RemoteComputerView, type RemoteJob, type RemoteJobLogs, type RemoteOs } from '@rerun/contracts'

import type { Database } from '@/app/api/database.types'
import { engineSocketUrl } from '@/app/api/_services/engine-socket.service'
import { buildBaseUrl } from '@/lib/engine/base-url'
import { getEngineHealth, supportsRemoteComputers } from '@/lib/engine/client'
import { mintRemoteTicket } from '@/lib/engine/engine-ticket'
import { addRemoteComputerRule, deleteRemoteComputer, getRemoteJobLogs, listRemoteComputers, listRemoteJobs, stopRemoteJob, upsertRemoteComputer } from '@/lib/engine/remote-client'
import { EngineRequestError } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { AppError } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'

// The computers people link to a workspace from the desktop app. The hub holds who they are and the
// token each app keeps (its hash only); the workspace's engine holds the socket, the rules and the
// jobs. The hub is the one that vouches for a computer: it signs the ticket the app opens its socket
// with, naming the computer, so the engine never takes the app's word for it.

type ComputerInsert = Database['public']['Tables']['remote_computers']['Insert']
type ComputerUpdate = Database['public']['Tables']['remote_computers']['Update']

export const REMOTE_COMPUTER_COLUMNS = ['id', 'workspace_id', 'name', 'handle', 'os', 'arch', 'hostname', 'app_version', 'linked_by', 'last_seen_at', 'revoked_at', 'created_at'] as const

export type RemoteComputerRow = Pick<Database['public']['Tables']['remote_computers']['Row'], (typeof REMOTE_COMPUTER_COLUMNS)[number]>

const UNIQUE_VIOLATION = '23505'
const MAX_HANDLE_TRIES = 50

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const identityOf = (row: Pick<RemoteComputerRow, 'id' | 'handle' | 'name'>): RemoteComputerIdentity => ({ id: row.id, handle: row.handle, name: row.name })

type WorkspaceSocketEngine = { conn: EngineConnection; hostId: string | null; boxIndex: number | null }

async function workspaceEngine(workspaceId: number): Promise<WorkspaceSocketEngine | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'engine_pool', ['engine_host', 'engine_api_key', 'host_id', 'box_index'] as const, { claimed_by_workspace_id: workspaceId })
    if (!data?.engine_host) return null
    return { conn: { baseUrl: buildBaseUrl(data.engine_host), apiKey: data.engine_api_key }, hostId: data.host_id, boxIndex: data.box_index }
}

// The engine learns about a computer when it is linked, renamed or set up, so its coworkers see it
// offline before it ever connects. Best effort: the ticket of its first connection names it anyway.
async function syncToEngine(workspaceId: number, row: Pick<RemoteComputerRow, 'id' | 'handle' | 'name'>, settings?: RemoteComputerSettingsPatch): Promise<RemoteComputerView | null> {
    const engine = await workspaceEngine(workspaceId)
    if (!engine || !(await supportsRemoteComputers(engine.conn))) return null
    return upsertRemoteComputer(engine.conn, row.id, { handle: row.handle, name: row.name, ...(settings ? { settings } : {}) })
}

function cleanName(name: string): string {
    const trimmed = name.replace(/\s+/g, ' ').trim()
    if (!trimmed || trimmed.length > 100) throw new AppError('computerNameInvalid')
    return trimmed
}

function handleCandidate(base: string, attempt: number): string {
    if (attempt === 0) return base
    const suffix = `-${attempt + 1}`
    return `${base.slice(0, 32 - suffix.length).replace(/-+$/, '')}${suffix}`
}

export type LinkComputerInput = { workspaceId: number; userId: string; name: string; os: RemoteOs; arch: string; hostname: string; appVersion: string }

// The token is shown once, to the app that asked for it; the hub keeps only its hash. Two computers
// of one workspace never share a handle: a taken one gets a number.
export async function linkComputer(input: LinkComputerInput): Promise<{ computer: RemoteComputerRow; token: string }> {
    const name = cleanName(input.name)
    const base = remoteHandleFromName(name) || 'computer'
    const token = `${REMOTE_COMPUTER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    const supabase = createServiceRoleClient()
    for (let attempt = 0; attempt < MAX_HANDLE_TRIES; attempt++) {
        const { data, error } = await supabase
            .from('remote_computers')
            .insert<ComputerInsert>({
                workspace_id: input.workspaceId,
                name,
                handle: handleCandidate(base, attempt),
                os: input.os,
                arch: input.arch.slice(0, 32),
                hostname: input.hostname.slice(0, 255),
                app_version: input.appVersion.slice(0, 64),
                token_hash: hashToken(token),
                linked_by: input.userId,
                last_seen_at: new Date().toISOString(),
            })
            .select(REMOTE_COMPUTER_COLUMNS.join(', '))
            .single<RemoteComputerRow>()
        if (error?.code === UNIQUE_VIOLATION) continue
        if (error || !data) throw new Error(error?.message ?? 'The computer could not be linked')
        await syncToEngine(input.workspaceId, data).catch(err => console.warn('[computers] engine not told of a new computer', err))
        return { computer: data, token }
    }
    throw new AppError('computerHandleTaken')
}

export class ComputerConnectError extends Error {
    constructor(
        readonly reason: 'invalid' | 'revoked' | 'no-engine' | 'engine-update' | 'unreachable',
        readonly status: number,
    ) {
        super(reason)
        this.name = 'ComputerConnectError'
    }
}

export type ComputerConnection = { socketUrl: string; computer: RemoteComputerIdentity; workspaceId: number }

// The app asks before each connection: a box restored elsewhere changes address, and only the hub
// knows where it went. A computer whose person left the workspace is unlinked here, for good.
export async function connectComputer(token: string, appVersion: string | null): Promise<ComputerConnection> {
    if (!token.startsWith(REMOTE_COMPUTER_TOKEN_PREFIX)) throw new ComputerConnectError('invalid', 401)
    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'remote_computers', REMOTE_COMPUTER_COLUMNS, { token_hash: hashToken(token) })
    if (!row) throw new ComputerConnectError('invalid', 401)
    if (row.revoked_at) throw new ComputerConnectError('revoked', 401)
    const member = row.linked_by ? (await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: row.workspace_id, user_id: row.linked_by })).data : null
    if (!member) {
        await revokeComputer(row.workspace_id, row.id)
        throw new ComputerConnectError('revoked', 401)
    }

    const engine = await workspaceEngine(row.workspace_id)
    if (!engine) throw new ComputerConnectError('no-engine', 503)
    if (!(await supportsRemoteComputers(engine.conn))) throw new ComputerConnectError('engine-update', 503)
    const base = await engineSocketUrl(engine.conn, engine.hostId, engine.boxIndex, REMOTE_WS_PATH)
    if (!base) throw new ComputerConnectError('unreachable', 503)

    const seen: ComputerUpdate = { last_seen_at: new Date().toISOString(), ...(appVersion ? { app_version: appVersion.slice(0, 64) } : {}) }
    await supabase.from('remote_computers').update<ComputerUpdate>(seen).eq('id', row.id)
    const computer = identityOf(row)
    return { socketUrl: `${base}?ticket=${encodeURIComponent(mintRemoteTicket(engine.conn.apiKey ?? '', computer))}`, computer, workspaceId: row.workspace_id }
}

async function liveRow(workspaceId: number, computerId: string): Promise<RemoteComputerRow> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'remote_computers', REMOTE_COMPUTER_COLUMNS, { id: computerId, workspace_id: workspaceId, revoked_at: { isNull: true } })
    if (!data) throw new AppError('computerNotFound')
    return data
}

// Its token stops working at once; its socket closes as soon as the engine hears of it.
export async function revokeComputer(workspaceId: number, computerId: string): Promise<void> {
    const { error } = await createServiceRoleClient().from('remote_computers').update<ComputerUpdate>({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', computerId).eq('workspace_id', workspaceId).is('revoked_at', null)
    if (error) throw new Error(error.message)
    const engine = await workspaceEngine(workspaceId)
    if (!engine || !(await supportsRemoteComputers(engine.conn))) return
    await deleteRemoteComputer(engine.conn, computerId).catch(err => console.warn('[computers] engine not told of an unlinked computer', err))
}

// The computer unlinks itself: false for a token the hub never issued or already revoked.
export async function unlinkByToken(token: string): Promise<boolean> {
    if (!token.startsWith(REMOTE_COMPUTER_TOKEN_PREFIX)) return false
    const { data: row } = await selectMaybeSingle(createServiceRoleClient(), 'remote_computers', ['id', 'workspace_id', 'revoked_at'] as const, { token_hash: hashToken(token) })
    if (!row || row.revoked_at) return false
    await revokeComputer(row.workspace_id, row.id)
    return true
}

// A person who leaves the workspace leaves with the computers they linked.
export async function revokeMemberComputers(workspaceId: number, userId: string): Promise<void> {
    const { data } = await selectAll(createServiceRoleClient(), 'remote_computers', ['id'] as const, { workspace_id: workspaceId, linked_by: userId, revoked_at: { isNull: true } })
    for (const { id } of data ?? []) await revokeComputer(workspaceId, id)
}

// The handle stays: a schedule or a message that names the computer still does.
export async function renameComputer(workspaceId: number, computerId: string, name: string): Promise<void> {
    const row = await liveRow(workspaceId, computerId)
    const clean = cleanName(name)
    const { error } = await createServiceRoleClient().from('remote_computers').update<ComputerUpdate>({ name: clean, updated_at: new Date().toISOString() }).eq('id', row.id)
    if (error) throw new Error(error.message)
    await syncToEngine(workspaceId, { ...row, name: clean })
}

// A box that does not answer offers nothing either: told apart from one too old for computers.
const engineAnswers = (conn: EngineConnection) => getEngineHealth(conn).then(
    () => true,
    () => false,
)

async function requireComputersEngine(workspaceId: number): Promise<EngineConnection> {
    const engine = await workspaceEngine(workspaceId)
    if (!engine) throw new AppError('computersNeedMachine')
    if (!(await supportsRemoteComputers(engine.conn))) throw new AppError((await engineAnswers(engine.conn)) ? 'computersNeedEngineUpdate' : 'computersEngineUnreachable')
    return engine.conn
}

export async function updateComputerSettings(workspaceId: number, computerId: string, settings: RemoteComputerSettingsPatch): Promise<RemoteComputerView> {
    const row = await liveRow(workspaceId, computerId)
    const conn = await requireComputersEngine(workspaceId)
    return upsertRemoteComputer(conn, row.id, { handle: row.handle, name: row.name, settings })
}

// An "always allow" answered on a card: written before the answer goes to the coworker, so the run
// it resumes already follows it.
export async function addComputerRule(workspaceId: number, computerId: string, rule: RemoteComputerRule): Promise<RemoteComputerView> {
    const row = await liveRow(workspaceId, computerId)
    const conn = await requireComputersEngine(workspaceId)
    await syncToEngine(workspaceId, row)
    return addRemoteComputerRule(conn, row.id, rule)
}

export type WorkspaceComputer = RemoteComputerRow & { view: RemoteComputerView | null }

// What the hub knows, with what the engine says of each computer now. `engine` is false when the
// box did not answer: every computer then reads offline rather than as it was last seen.
export async function listWorkspaceComputers(workspaceId: number): Promise<{ computers: WorkspaceComputer[]; engine: 'ok' | 'unreachable' | 'needs-update' | 'none' }> {
    const { data } = await selectAll(createServiceRoleClient(), 'remote_computers', REMOTE_COMPUTER_COLUMNS, { workspace_id: workspaceId, revoked_at: { isNull: true } })
    const rows = (data ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))
    const engine = await workspaceEngine(workspaceId)
    if (!engine) return { computers: rows.map(row => ({ ...row, view: null })), engine: 'none' }
    if (!(await supportsRemoteComputers(engine.conn))) return { computers: rows.map(row => ({ ...row, view: null })), engine: (await engineAnswers(engine.conn)) ? 'needs-update' : 'unreachable' }
    let views: RemoteComputerView[]
    try {
        views = await listRemoteComputers(engine.conn)
    } catch {
        return { computers: rows.map(row => ({ ...row, view: null })), engine: 'unreachable' }
    }
    await forgetUnlinkedOnEngine(workspaceId, engine.conn, rows, views)
    const byId = new Map(views.map(view => [view.id, view]))
    const missing = rows.filter(row => !byId.has(row.id))
    for (const row of missing) {
        const view = await syncToEngine(workspaceId, row).catch(() => null)
        if (view) byId.set(row.id, view)
    }
    return { computers: rows.map(row => ({ ...row, view: byId.get(row.id) ?? null })), engine: 'ok' }
}

// A box that could not be told of an unlink (it was away, or the call failed) still lists the
// computer, and would keep a new one of the same handle out of reach. Only a computer the hub holds
// as unlinked is taken off: one it does not know at all may belong to another hub of the same box.
async function forgetUnlinkedOnEngine(workspaceId: number, conn: EngineConnection, rows: RemoteComputerRow[], views: RemoteComputerView[]): Promise<void> {
    const linked = new Set(rows.map(row => row.id))
    for (const view of views) {
        if (linked.has(view.id)) continue
        const { data: row } = await selectMaybeSingle(createServiceRoleClient(), 'remote_computers', ['id', 'revoked_at'] as const, { id: view.id, workspace_id: workspaceId })
        if (row?.revoked_at) await deleteRemoteComputer(conn, view.id).catch(err => console.warn('[computers] engine still lists an unlinked computer', err))
    }
}

export async function hasLinkedComputers(workspaceId: number): Promise<boolean> {
    const { data } = await selectCount(createServiceRoleClient(), 'remote_computers', { workspace_id: workspaceId, revoked_at: { isNull: true } })
    return (data ?? 0) > 0
}

// A computer of the workspace named by its #handle, as the chat names it.
async function liveRowByHandle(workspaceId: number, handle: string): Promise<RemoteComputerRow> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'remote_computers', REMOTE_COMPUTER_COLUMNS, { workspace_id: workspaceId, handle: computerHandleOf(handle), revoked_at: { isNull: true } })
    if (!data) throw new AppError('computerNotFound')
    return data
}

// Null when the computer is offline: its jobs live on it, and it answers for them once back.
async function offlineAsNull<T>(call: () => Promise<T>): Promise<T | null> {
    try {
        return await call()
    } catch (err) {
        if (err instanceof EngineRequestError && err.status === 409) return null
        throw err
    }
}

export async function computerJobs(workspaceId: number, computerId: string): Promise<RemoteJob[] | null> {
    const row = await liveRow(workspaceId, computerId)
    const conn = await requireComputersEngine(workspaceId)
    return offlineAsNull(() => listRemoteJobs(conn, row.id))
}

export async function computerJobLogs(workspaceId: number, handle: string, jobId: string): Promise<RemoteJobLogs | null> {
    const row = await liveRowByHandle(workspaceId, handle)
    const conn = await requireComputersEngine(workspaceId)
    return offlineAsNull(() => getRemoteJobLogs(conn, row.id, jobId))
}

export async function stopComputerJob(workspaceId: number, computerId: string, jobId: string): Promise<RemoteJob | null> {
    const row = await liveRow(workspaceId, computerId)
    const conn = await requireComputersEngine(workspaceId)
    return offlineAsNull(() => stopRemoteJob(conn, row.id, jobId))
}

export async function computerIdByHandle(workspaceId: number, handle: string): Promise<string> {
    return (await liveRowByHandle(workspaceId, handle)).id
}
