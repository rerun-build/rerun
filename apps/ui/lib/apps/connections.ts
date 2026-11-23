import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMany } from '@/supabase/supabase-helpers'
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

// Counts a call against every window of its pace and returns the counts after it, in the order of
// `periods`. Never refuses: a pace is a recommendation the coworker tells the user about.
export async function countUsage(supabase: Client, scope: string, action: string, periods: string[], amount = 1): Promise<number[]> {
    const { data, error } = await supabase.rpc('count_app_usage', { p_scope: scope, p_action: action, p_periods: periods, p_amount: amount })
    if (error) throw new Error(error.message)
    return data ?? []
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

export type AgentConnection = Pick<AppConnectionRow, (typeof APP_CONNECTION_COLUMNS)[number]>

// The accounts a coworker acts with, in the order it got them, read fresh on every call: a binding
// and the account's status are moved by other paths (a freeze, a disconnect) and the proxy is the one
// place that has to agree with them.
export async function agentConnections(supabase: Client, agentId: string, slug: AppSlug): Promise<AgentConnection[]> {
    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['connection_id'] as const, { agent_id: agentId, app_slug: slug }, { column: 'created_at', ascending: true })
    if (!bindings?.length) return []
    const { data: rows } = await selectMany(supabase, 'app_connections', APP_CONNECTION_COLUMNS, { id: bindings.map(binding => binding.connection_id), status: { neq: 'deleted' } })
    return bindings.flatMap(binding => rows?.find(row => row.id === binding.connection_id) ?? [])
}

// What a call names an account by: its label, which two LinkedIn profiles can share, the provider's
// own id of the person or the number, or ours.
function namesAccount(account: AgentConnection, asked: string): boolean {
    const plain = (value: string) => value.trim().toLowerCase().replace(/^\+/, '')
    const same = (value: string | null) => value !== null && plain(value) === plain(asked)
    return same(account.label) || same(account.provider_member_id) || same(account.id)
}

export function accountNames(accounts: AgentConnection[]): string {
    const labels = accounts.map(account => account.label)
    return accounts
        .map(account => {
            const name = account.label ?? account.provider_member_id ?? account.id
            const shared = labels.filter(label => label === account.label).length > 1
            return shared ? `"${account.provider_member_id ?? account.id}" (${name})` : `"${name}"`
        })
        .join(', ')
}

export type PickedConnection = { connection: AgentConnection } | { refusal: string }

// The account a call acts with. Never one of several at random, and never another one than the call
// names: an account taken off the coworker since is refused rather than replaced.
export function pickConnection(accounts: AgentConnection[], asked: string | null, providerLabel: string): PickedConnection {
    const matching = asked ? accounts.filter(account => namesAccount(account, asked)) : accounts
    if (matching.length === 1) return { connection: matching[0] }
    const reason = !asked ? `You act with ${accounts.length} ${providerLabel} accounts and this call names none.` : matching.length === 0 ? `You do not act with a ${providerLabel} account named "${asked}".` : `Several of your ${providerLabel} accounts are named "${asked}".`
    return { refusal: `${reason} Nothing was sent. Pass account, one of: ${accountNames(accounts)}. If the user has not said which one, ask.` }
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
