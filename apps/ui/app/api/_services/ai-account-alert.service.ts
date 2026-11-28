import 'server-only'
import { RERUN_CONNECTION_ID, type Provider } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { brandAppUrl } from '@/lib/brand/urls'
import { workspaceBrand } from '@/lib/brand/workspace'
import { alertBanner, BANNER_WARM_BACKGROUND_MS } from '@/lib/email/board-banner'
import { PLAN_PROVIDERS, planName, RECONNECT_PARAM } from '@/lib/engine/ai-sources'
import { getAgent, getConnectionUsage, listConnections } from '@/lib/engine/client'
import type { BoxConnection, EngineConnection } from '@/lib/engine/types'
import { copyToShippedForemanRow } from '@/lib/foreman/conversation'
import { ACCOUNT_REFUSED_ERROR_CODE } from '@/lib/notifications/budget-notice'
import { causeAlertBoard } from '@/lib/og/alert-crew'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

import { adminsToAlert, resolveAlert, sendAlert } from './admin-alert.service'
import { sendAccountSignedOutEmail } from './email.service'
import { findWorkspaceEngine } from './workspace-engine.service'

type Client = SupabaseClient<Database>

// What closes an alert is a request of the engine, sent once. Were it lost, the account would never be
// alerted about again: past a month, an alert left open no longer counts.
const FORGOTTEN_AFTER_MS = 30 * 24 * 60 * 60_000
// Each coworker's model is one request to the machine, which has runs of its own to serve.
const AGENTS_AT_A_TIME = 6

const alertKeyPrefix = (workspaceId: number) => `workspace:${workspaceId}:ai-account:`

const isRejected = (connection: BoxConnection) => connection.id !== RERUN_CONNECTION_ID && connection.credentialRejected

/**
 * A run was turned away by its provider: the admins hear once which account it was, whichever of its
 * runs fail next. `provider` is the one the run named; an engine that names none has every account read.
 */
export async function alertSignedOutAccounts(workspaceId: number, provider: string | null): Promise<void> {
    try {
        const engine = await findWorkspaceEngine(workspaceId)
        if (!engine) return
        const { connections } = await listConnections(engine.conn)
        const supabase = createServiceRoleClient()
        for (const connection of connections) {
            if (isRejected(connection) && (!provider || connection.provider === provider)) await alertSignedOut(supabase, workspaceId, engine.conn, connection)
        }
    } catch (err) {
        console.error('[ai-account] failed to alert about an account', workspaceId, err)
    }
}

async function alertSignedOut(supabase: Client, workspaceId: number, conn: EngineConnection, connection: BoxConnection): Promise<void> {
    const brand = await workspaceBrand(workspaceId)
    const alert = { workspaceId, key: `${alertKeyPrefix(workspaceId)}${connection.id}`, awayOnly: true, reopenAfterMs: FORGOTTEN_AFTER_MS, brand }
    const adminIds = await adminsToAlert(supabase, alert)
    if (!adminIds.length) return

    const [{ data: workspace }, stopped] = await Promise.all([selectMaybeSingle(supabase, 'workspaces', ['name'] as const, { id: workspaceId }), stoppedCoworkers(supabase, workspaceId, conn, connection.id)])
    const board = stopped.length ? causeAlertBoard(supabase, workspaceId, connection.provider, stopped.map(agent => agent.id)) : null
    const boardUrl = await alertBanner(board, BANNER_WARM_BACKGROUND_MS, brand)
    await sendAlert(supabase, alert, adminIds, ({ to, locale, unsubscribeUrl }) =>
        sendAccountSignedOutEmail({
            to,
            kind: isSubscription(connection.provider) ? 'subscription' : 'key',
            account: planName(connection),
            coworkers: stopped.map(agent => agent.name),
            workspaceName: workspace?.name ?? null,
            reconnectUrl: `${brandAppUrl(brand)}/?${WORKSPACE_PARAM}=${workspaceId}&${RECONNECT_PARAM}=${encodeURIComponent(connection.id)}`,
            boardUrl,
            unsubscribeUrl,
            locale,
            brand,
        }),
    )
}

const isSubscription = (provider: Provider) => (PLAN_PROVIDERS as Provider[]).includes(provider)

// A coworker whose own model runs on the account, or one of whose scheduled tasks or triggers does. A
// backup connection only takes over from a usage limit, never from an account turned away.
async function stoppedCoworkers(supabase: Client, workspaceId: number, conn: EngineConnection, connectionId: string): Promise<{ id: string; name: string }[]> {
    const { data: agents } = await selectMany(supabase, 'agents', ['id', 'name', 'engine_agent_id'] as const, { workspace_id: workspaceId, kind: 'coworker', disabled_at: { isNull: true } }, { column: 'created_at', ascending: true })
    const usage = await getConnectionUsage(conn, connectionId).catch(() => null)
    const automated = new Set(usage?.automations.map(automation => automation.agentId))

    const runsOnIt = async (engineAgentId: string): Promise<boolean> => automated.has(engineAgentId) || (await getAgent(conn, engineAgentId).catch(() => null))?.resolvedConnectionId === connectionId
    const stopped: { id: string; name: string }[] = []
    const known = (agents ?? []).filter(agent => agent.name.trim())
    for (let start = 0; start < known.length; start += AGENTS_AT_A_TIME) {
        const batch = known.slice(start, start + AGENTS_AT_A_TIME)
        const flags = await Promise.all(batch.map(agent => (agent.engine_agent_id ? runsOnIt(agent.engine_agent_id) : false)))
        stopped.push(...batch.filter((_, index) => flags[index]).map(agent => ({ id: agent.id, name: agent.name.trim() })))
    }
    return stopped
}

/**
 * An account was connected, or a run went through on one of `provider`: the alerts about those that work
 * again close, so the next stop is heard of. A run only speaks for the accounts of its own provider: a
 * machine that restarted no longer knows which accounts were refused until a run fails on them.
 */
export async function closeReconnectedAccounts(workspaceId: number, provider?: string): Promise<void> {
    try {
        const supabase = createServiceRoleClient()
        const prefix = alertKeyPrefix(workspaceId)
        const { data: open } = await selectMany(supabase, 'notification_incidents', ['source_key'] as const, { source_key: { ilike: `${prefix}%` }, resolved_at: { isNull: true } })
        const keys = [...new Set((open ?? []).map(incident => incident.source_key))]
        if (!keys.length) return

        const engine = await findWorkspaceEngine(workspaceId)
        if (!engine) return
        const { connections } = await listConnections(engine.conn)
        const stillStopped = new Set(connections.filter(connection => isRejected(connection) || (provider && connection.provider !== provider)).map(connection => `${prefix}${connection.id}`))
        for (const key of keys) if (!stillStopped.has(key)) await resolveAlert(supabase, key)
    } catch (err) {
        console.error('[ai-account] failed to close the alerts of a reconnected account', workspaceId, err)
    }
}

// Every id goes in the URL of its request: a weekend of hourly runs on a signed-out account is
// hundreds of conversations, more than a gateway lets through in one.
const IDS_PER_REQUEST = 100

const inBatches = <T>(items: T[]): T[][] => Array.from({ length: Math.ceil(items.length / IDS_PER_REQUEST) }, (_, index) => items.slice(index * IDS_PER_REQUEST, (index + 1) * IDS_PER_REQUEST))

/**
 * An account was connected again: the conversations its refusal stopped leave « To handle ». A
 * scheduled run's conversation gets no next run to clear it, so it would stay in error for good. Only
 * those whose last word is that refusal, on that provider (any, when the engine names none): an error
 * of another kind still waits on the user. A refusal names its provider, not its account, so while
 * another account of that provider is still turned away, none is released.
 */
export async function releaseSignedOutSessions(workspaceId: number, provider: string | null): Promise<void> {
    const failedTo = (what: string, err: unknown) => console.error(`[ai-account] failed to ${what} of a reconnected account`, workspaceId, err)
    try {
        const engine = await findWorkspaceEngine(workspaceId)
        if (!engine) return
        const { connections } = await listConnections(engine.conn)
        if (connections.some(connection => isRejected(connection) && (!provider || connection.provider === provider))) return

        const supabase = createServiceRoleClient()
        const { data: agents, error: agentsError } = await selectAll(supabase, 'agents', ['id', 'kind'] as const, { workspace_id: workspaceId })
        if (agentsError) return failedTo('read the coworkers', agentsError)
        const agentIds = (agents ?? []).map(agent => agent.id)
        if (!agentIds.length) return
        const chief = new Set((agents ?? []).filter(agent => agent.kind === 'foreman').map(agent => agent.id))

        const { data: failed, error: failedError } = await selectAll(supabase, 'sessions', ['id', 'agent_id', 'engine_session_id'] as const, { agent_id: agentIds, status: 'error' })
        if (failedError) return failedTo('read the conversations in error', failedError)
        const stopped = (failed ?? []).filter((session): session is typeof session & { engine_session_id: string } => !!session.engine_session_id)
        if (!stopped.length) return

        const lastWord = new Map<string, { kind: string; metadata: unknown }>()
        for (const batch of inBatches(stopped)) {
            const { data: notifications, error } = await selectAll(supabase, 'notifications', ['agent_id', 'engine_session_id', 'kind', 'metadata'] as const, { agent_id: [...new Set(batch.map(session => session.agent_id))], engine_session_id: batch.map(session => session.engine_session_id), kind: { neq: 'done' } }, { column: 'created_at', ascending: false })
            if (error) return failedTo('read the notifications', error)
            for (const notification of notifications ?? []) {
                const key = `${notification.agent_id}:${notification.engine_session_id}`
                if (!lastWord.has(key)) lastWord.set(key, notification)
            }
        }
        const refusedHere = (metadata: unknown) => {
            const { errorCode, provider: refusedProvider } = (metadata ?? {}) as { errorCode?: unknown; provider?: unknown }
            return errorCode === ACCOUNT_REFUSED_ERROR_CODE && (!provider || refusedProvider === provider)
        }
        const released = stopped.filter(session => {
            const last = lastWord.get(`${session.agent_id}:${session.engine_session_id}`)
            return last?.kind === 'error' && refusedHere(last.metadata)
        })
        const chiefSessions = new Set(released.filter(session => chief.has(session.agent_id)).map(session => session.id))

        for (const batch of inBatches(released.map(session => session.id))) {
            // The status filter is the race guard: a conversation back at work since belongs to its run.
            const { data: updated, error } = await supabase.from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ status: 'idle' }).in('id', batch).eq('status', 'error').select('id')
            if (error) failedTo('release the conversations', error)
            for (const row of updated ?? []) if (chiefSessions.has(row.id)) await copyToShippedForemanRow(row.id)
        }
    } catch (err) {
        failedTo('release the conversations', err)
    }
}
