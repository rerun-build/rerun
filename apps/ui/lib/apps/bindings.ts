import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { deleteTrigger, getAgent, patchMcpServers } from '@/lib/engine/client'
import { readRegistry, upsertRegistryEntry } from '@/lib/services/registry'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { appInfo } from './catalog'
import { agentConnections, type AgentConnection } from './connections'
import type { AppSlug } from './types'

type Client = SupabaseClient<Database>
type BindingUpdate = Database['public']['Tables']['app_connection_agents']['Update']

// Removes the wake-up trigger one account put on the coworker and forgets it. Best effort on the
// engine side: a box that is gone has no trigger left to remove.
export async function dropWakeTrigger(supabase: Client, workspaceId: number, agentId: string, connectionId: string, slug: AppSlug): Promise<void> {
    const { data: binding } = await selectMaybeSingle(supabase, 'app_connection_agents', ['trigger_slug'] as const, { agent_id: agentId, connection_id: connectionId })
    if (!binding?.trigger_slug) return
    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['engine_agent_id'] as const, { id: agentId })
    if (agent?.engine_agent_id) {
        const conn = await getWorkspaceConnection(workspaceId).catch(() => null)
        if (conn) await deleteTrigger(conn, agent.engine_agent_id, binding.trigger_slug).catch(err => console.warn(`[apps:${slug}] could not delete the wake trigger`, err))
    }
    const { error } = await supabase
        .from('app_connection_agents')
        .update<BindingUpdate>({ trigger_slug: null, trigger_token: null, wake_on_events: [], updated_at: new Date().toISOString() })
        .eq('agent_id', agentId)
        .eq('connection_id', connectionId)
    if (error) throw new Error(error.message)
}

// What uninstalling the app's service from a coworker leaves behind: no account, no wake-ups.
export async function unbindAgent(supabase: Client, workspaceId: number, agentId: string, slug: AppSlug): Promise<void> {
    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['connection_id'] as const, { agent_id: agentId, app_slug: slug })
    for (const binding of bindings ?? []) await dropWakeTrigger(supabase, workspaceId, agentId, binding.connection_id, slug)
    const { error } = await supabase.from('app_connection_agents').delete().eq('agent_id', agentId).eq('app_slug', slug)
    if (error) throw new Error(error.message)
}

// One account taken off one coworker, with its wake-ups: the other accounts keep theirs.
export async function unbindAccount(supabase: Client, workspaceId: number, agentId: string, connectionId: string, slug: AppSlug): Promise<void> {
    await dropWakeTrigger(supabase, workspaceId, agentId, connectionId, slug)
    const { error } = await supabase.from('app_connection_agents').delete().eq('agent_id', agentId).eq('connection_id', connectionId)
    if (error) throw new Error(error.message)
}

// An account that is gone leaves every coworker that acted with it.
export async function unbindConnection(supabase: Client, workspaceId: number, connectionId: string, slug: AppSlug): Promise<void> {
    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['agent_id'] as const, { connection_id: connectionId })
    for (const { agent_id: agentId } of bindings ?? []) {
        await unbindAccount(supabase, workspaceId, agentId, connectionId, slug)
        await syncAppConnector(supabase, agentId, slug).catch(err => console.warn(`[apps:${slug}] connector of agent ${agentId} left as it was:`, err instanceof Error ? err.message : err))
    }
}

function accountsFingerprint(accounts: AgentConnection[]): string {
    return createHash('sha256').update(JSON.stringify(accounts.map(account => [account.id, account.label]))).digest('hex').slice(0, 12)
}

function withAccounts(url: string, fingerprint: string): string {
    const [path, query] = url.split('?')
    const params = new URLSearchParams(query)
    params.set('accounts', fingerprint)
    return `${path}?${params}`
}

// Brings the app's connector on the coworker in line with the accounts it holds. The engine reads a
// server's tools once and keeps them for as long as it dials it the same way, so the accounts are part
// of the address: the tools that name them are read again. Answers how many it holds.
export async function syncAppConnector(supabase: Client, agentId: string, slug: AppSlug): Promise<number> {
    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['workspace_id', 'engine_agent_id'] as const, { id: agentId })
    if (!agent?.engine_agent_id) return 0
    const accounts = await agentConnections(supabase, agentId, slug)
    const conn = await getWorkspaceConnection(agent.workspace_id)
    const { serviceSlug } = appInfo(slug)
    const entry = (await readRegistry(conn, agent.engine_agent_id)).services[serviceSlug]
    if (!entry?.app) return accounts.length

    const { appSlug, serverName } = entry.app
    const accountLabel = accounts.flatMap(account => account.label ?? []).join(', ')
    await upsertRegistryEntry(conn, agent.engine_agent_id, serviceSlug, { ...entry, status: accounts.length > 0 ? 'active' : 'needs_auth', app: { appSlug, serverName, ...(accountLabel ? { accountLabel } : {}) } })

    const server = (await getAgent(conn, agent.engine_agent_id)).config.mcpServers?.find(candidate => candidate.name === serverName)
    if (server?.url) await patchMcpServers(conn, agent.engine_agent_id, { upsert: [{ ...server, url: withAccounts(server.url, accountsFingerprint(accounts)) }] })
    return accounts.length
}
