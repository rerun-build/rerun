import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { notifyWorkspace } from './notify'
import { appDefinition } from './registry'
import { APP_CONNECTION_COLUMNS, type AppSlug } from './types'

type Client = SupabaseClient<Database>
type ConnectionUpdate = Database['public']['Tables']['app_connections']['Update']

export type AppConnectionRow = Database['public']['Tables']['app_connections']['Row']

export const RATE_LIMIT_PAUSE_MS = 24 * 60 * 60_000

// Atomic and all-or-nothing across the windows: an invitation is refused without eating its day
// when its week is full. See claim_app_quota.
export async function claimQuota(supabase: Client, scope: string, action: string, periods: string[], maxes: number[], amount = 1): Promise<boolean> {
    const { data, error } = await supabase.rpc('claim_app_quota', { p_scope: scope, p_action: action, p_periods: periods, p_maxes: maxes, p_amount: amount })
    if (error) throw new Error(error.message)
    return data === true
}

export function connectionScope(connectionId: string): string {
    return `connection:${connectionId}`
}

export function workspaceScope(workspaceId: number): string {
    return `workspace:${workspaceId}`
}

export async function updateConnection(supabase: Client, connectionId: string, update: ConnectionUpdate): Promise<void> {
    const { error } = await supabase
        .from('app_connections')
        .update<ConnectionUpdate>({ ...update, updated_at: new Date().toISOString() })
        .eq('id', connectionId)
    if (error) throw new Error(error.message)
}

export type AgentConnection =
    | { ok: true; connection: Pick<AppConnectionRow, (typeof APP_CONNECTION_COLUMNS)[number]>; appStatus: string }
    | { ok: false; reason: 'not_attached' | 'not_found' }

// The account a coworker acts with, read fresh on every call: a coworker's binding, the app's
// status and the account's are all moved by other paths (a freeze, a disconnect) and the proxy is
// the one place that has to agree with them.
export async function agentConnection(supabase: Client, agentId: string, slug: AppSlug): Promise<AgentConnection> {
    const { data: binding } = await selectMaybeSingle(supabase, 'app_connection_agents', ['connection_id'] as const, { agent_id: agentId, app_slug: slug })
    if (!binding) return { ok: false, reason: 'not_attached' }
    const { data: connection } = await selectMaybeSingle(supabase, 'app_connections', APP_CONNECTION_COLUMNS, { id: binding.connection_id })
    if (!connection) return { ok: false, reason: 'not_found' }
    const { data: app } = await selectMaybeSingle(supabase, 'workspace_apps', ['status'] as const, { workspace_id: connection.workspace_id, app_slug: slug })
    return { ok: true, connection, appStatus: app?.status ?? 'uninstalled' }
}

// The provider itself said stop. The account rests a day, the workspace hears about it, and the pause
// lifts by itself on the first call after it ends.
export async function pauseForRateLimit(supabase: Client, connection: { id: string; workspace_id: number; label: string | null }, slug: AppSlug): Promise<void> {
    await updateConnection(supabase, connection.id, { status: 'paused', pause_reason: 'rate_limited', paused_until: new Date(Date.now() + RATE_LIMIT_PAUSE_MS).toISOString() })
    const app = appDefinition(slug)
    await notifyWorkspace(supabase, connection.workspace_id, {
        appName: app.name,
        message: `${app.providerLabel} asked ${connection.label ?? 'one of your accounts'} to slow down. Your coworkers will not use it for 24 hours, so the account stays safe.`,
        copy: { key: 'rateLimited', values: { provider: app.providerLabel, account: connection.label ?? 'none' } },
        email: true,
    })
}

export async function markNeedsReconnect(supabase: Client, connection: { id: string; workspace_id: number; label: string | null }, slug: AppSlug, reason: string): Promise<void> {
    await updateConnection(supabase, connection.id, { status: 'needs_reconnect', pause_reason: reason, paused_until: null })
    const app = appDefinition(slug)
    await notifyWorkspace(supabase, connection.workspace_id, {
        appName: app.name,
        message: `${app.providerLabel} signed ${connection.label ?? 'one of your accounts'} out. Reconnect it from Settings → Apps so your coworkers can use it again.`,
        copy: { key: 'signedOut', values: { provider: app.providerLabel, account: connection.label ?? 'none' } },
        email: true,
    })
}
