// No 'server-only': the archive, restore and expiry tasks call this from Trigger.dev.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { deleteTrigger } from '@/lib/engine/client'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { notifyWorkspace } from './notify'
import { SLOT_PAUSE_REASONS } from './slots-sync'
import { appDefinition } from './registry'
import { appTransition, targetAppStatus } from './status'
import { APP_CONNECTION_COLUMNS, SLOT_HOLDING_STATUSES, isAppSlug, type AppSlug, type AppStatus } from './types'

type Client = SupabaseClient<Database>
type WorkspaceAppUpdate = Database['public']['Tables']['workspace_apps']['Update']
type ConnectionUpdate = Database['public']['Tables']['app_connections']['Update']

type LiveConnection = { id: string; provider_account_id: string | null; status: string; pause_reason: string | null }

// Deletes the provider accounts behind `connections`, one by one so a failure leaves the others
// done. What failed stays for the daily reconciliation, which deletes any account whose row no
// longer says connected.
async function deleteProviderAccounts(slug: AppSlug, connections: LiveConnection[]): Promise<void> {
    const app = appDefinition(slug)
    for (const connection of connections) {
        if (!connection.provider_account_id) continue
        try {
            await app.deleteProviderAccount(connection.provider_account_id)
        } catch (err) {
            console.error(`[apps:${slug}] could not delete provider account ${connection.provider_account_id}`, err)
        }
    }
}

async function liveConnections(supabase: Client, workspaceId: number, slug: AppSlug): Promise<LiveConnection[]> {
    const { data } = await selectMany(supabase, 'app_connections', APP_CONNECTION_COLUMNS, { workspace_id: workspaceId, app_slug: slug, status: [...SLOT_HOLDING_STATUSES] })
    return data ?? []
}

async function setConnectionStatus(supabase: Client, ids: string[], update: ConnectionUpdate): Promise<void> {
    if (ids.length === 0) return
    const { error } = await supabase
        .from('app_connections')
        .update<ConnectionUpdate>({ ...update, updated_at: new Date().toISOString() })
        .in('id', ids)
    if (error) throw new Error(error.message)
}

// A frozen account is deleted at the provider, not merely paused: Linkup bills every day an account
// stays connected, and a workspace that does not pay must not cost anything. Its coworker bindings
// stay, so a reconnect after the restore puts everything back where it was.
// An account already paused for want of a paid slot stays paused: turning it into one waiting for a
// reconnect would let a new sign-in bring it back without the slot being paid.
async function freeze(supabase: Client, workspaceId: number, slug: AppSlug): Promise<void> {
    const connections = (await liveConnections(supabase, workspaceId, slug)).filter(connection => connection.provider_account_id)
    await deleteProviderAccounts(slug, connections)
    await setConnectionStatus(
        supabase,
        connections.filter(connection => !(connection.status === 'paused' && (SLOT_PAUSE_REASONS as readonly string[]).includes(connection.pause_reason ?? ''))).map(connection => connection.id),
        { status: 'needs_reconnect', paused_until: null, pause_reason: 'workspace_paused' },
    )
}

async function resume(supabase: Client, workspaceId: number, slug: AppSlug): Promise<void> {
    const connections = await liveConnections(supabase, workspaceId, slug)
    if (connections.length === 0) return
    const app = appDefinition(slug)
    await notifyWorkspace(supabase, workspaceId, {
        appName: app.name,
        message: `Your workspace is back. Reconnect your ${app.providerLabel} account from Settings → Apps so your coworkers can use it again.`,
        copy: { key: 'workspaceBack', values: { provider: app.providerLabel } },
        email: false,
    })
}

async function uninstall(supabase: Client, workspaceId: number, slug: AppSlug): Promise<void> {
    const connections = await liveConnections(supabase, workspaceId, slug)
    await deleteProviderAccounts(slug, connections)
    await removeAppTriggers(supabase, workspaceId, connections.map(connection => connection.id))
    await setConnectionStatus(
        supabase,
        connections.map(connection => connection.id),
        { status: 'deleted', paused_until: null, pause_reason: null },
    )
}

// The wake-up triggers live on the engine. Best effort: an uninstall usually follows the box's
// own deletion, and then there is nothing left to clean.
async function removeAppTriggers(supabase: Client, workspaceId: number, connectionIds: string[]): Promise<void> {
    if (connectionIds.length === 0) return
    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['agent_id', 'trigger_slug'] as const, { connection_id: connectionIds })
    if (!bindings?.length) return

    const engine = await findWorkspaceEngine(workspaceId).catch(() => null)
    if (engine) {
        const withTrigger = bindings.filter(binding => binding.trigger_slug)
        const { data: agents } = withTrigger.length ? await selectMany(supabase, 'agents', ['id', 'engine_agent_id'] as const, { id: withTrigger.map(binding => binding.agent_id) }) : { data: [] }
        const engineIdOf = new Map((agents ?? []).map(agent => [agent.id, agent.engine_agent_id]))
        for (const binding of withTrigger) {
            const engineAgentId = engineIdOf.get(binding.agent_id)
            if (!engineAgentId || !binding.trigger_slug) continue
            await deleteTrigger(engine.conn, engineAgentId, binding.trigger_slug).catch(err => console.warn(`[apps] could not delete trigger ${binding.trigger_slug}`, err))
        }
    }

    const { error } = await supabase.from('app_connection_agents').delete().in('connection_id', connectionIds)
    if (error) throw new Error(error.message)
}

async function writeStatus(supabase: Client, workspaceId: number, slug: string, status: AppStatus): Promise<void> {
    const now = new Date().toISOString()
    const { error } = await supabase
        .from('workspace_apps')
        .update<WorkspaceAppUpdate>({ status, frozen_at: status === 'frozen' ? now : null, updated_at: now })
        .eq('workspace_id', workspaceId)
        .eq('app_slug', slug)
    if (error) throw new Error(error.message)
}

/**
 * Brings every app of the workspace to what its box says: frozen while archived, uninstalled once
 * deleted, active otherwise. Idempotent, so every place the box changes can call it, and calling it
 * twice changes nothing the second time. `uninstall` forces the end whatever the box says, for the
 * paths that delete the workspace row itself.
 */
export async function syncWorkspaceApps(supabase: Client, workspaceId: number, { uninstall: forceUninstall = false }: { uninstall?: boolean } = {}): Promise<void> {
    const { data: apps } = await selectMany(supabase, 'workspace_apps', ['app_slug', 'status'] as const, { workspace_id: workspaceId })
    if (!apps?.length) return

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['boxes_archived_at', 'boxes_deleted_at'] as const, { id: workspaceId })
    const target: AppStatus = forceUninstall || !workspace ? 'uninstalled' : targetAppStatus(workspace)

    for (const app of apps) {
        if (!isAppSlug(app.app_slug)) continue
        const current = app.status as AppStatus
        const transition = appTransition(current, target)
        if (transition === 'freeze') await freeze(supabase, workspaceId, app.app_slug)
        if (transition === 'resume') await resume(supabase, workspaceId, app.app_slug)
        if (transition === 'uninstall') await uninstall(supabase, workspaceId, app.app_slug)
        if (current !== target) await writeStatus(supabase, workspaceId, app.app_slug, target)
    }
}

// Every hook site calls through here: the change of box it follows already happened and must not be
// undone by an app that failed to follow.
export async function syncWorkspaceAppsSafely(supabase: Client, workspaceId: number, options?: { uninstall?: boolean }): Promise<void> {
    try {
        await syncWorkspaceApps(supabase, workspaceId, options)
    } catch (err) {
        console.error(`[apps] sync of workspace ${workspaceId} failed`, err)
    }
}
