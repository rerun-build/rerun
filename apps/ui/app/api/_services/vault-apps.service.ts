import 'server-only'

import { paidAppFlag, unbindAgent } from '@rerun/cloud/apps.server'

import { assertAgentAccess, requireLightSessionActor, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import { appInfo } from '@/lib/apps/catalog'
import { APP_SLUGS, SLOT_HOLDING_STATUSES, type AppConnectionStatus, type AppSlug } from '@/lib/apps/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { attachAgentToConnection } from './apps.service'
import { installService, markAppAuthorized, uninstallService } from './services.service'

// The accounts of the paid apps (LinkedIn Pro, WhatsApp Pro), as the Vault lists them. They already
// belong to the workspace, in Supabase, with their slots and their bill: the Vault only shows them and
// attaches coworkers to them through the paid apps' own path, nothing about them moves.

export type VaultPaidAccount = {
    slug: AppSlug
    name: string
    serviceSlug: string
    connectionId: string
    label: string | null
    status: AppConnectionStatus
    // The hub's ids of the coworkers acting with this account that the caller can see.
    agentIds: string[]
    hiddenAgents: number
}

export async function vaultPaidAccounts(actor?: Actor): Promise<VaultPaidAccount[]> {
    const resolved = actor ?? (await requireLightSessionActor())
    const slugs = (await Promise.all(APP_SLUGS.map(async slug => ((await paidAppFlag(slug)) ? slug : null)))).filter((slug): slug is AppSlug => slug !== null)
    if (slugs.length === 0) return []
    const supabase = createServiceRoleClient()
    const { data: rows } = await selectMany(supabase, 'app_connections', ['id', 'app_slug', 'label', 'status'] as const, { workspace_id: resolved.workspaceId, app_slug: slugs, status: [...SLOT_HOLDING_STATUSES] }, { column: 'created_at', ascending: true })
    const connections = rows ?? []
    if (connections.length === 0) return []
    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['agent_id', 'connection_id'] as const, { connection_id: connections.map(connection => connection.id) })
    const { data: agents } = bindings?.length ? await selectMany(supabase, 'agents', ['id', 'space_id'] as const, { id: bindings.map(binding => binding.agent_id) }) : { data: [] }
    const visible = await visibleSpaceIds(resolved)
    const spaceOf = new Map((agents ?? []).map(agent => [agent.id, agent.space_id]))
    const sees = (agentId: string) => visible === 'all' || visible.has(spaceOf.get(agentId) ?? '')
    return connections.map(connection => {
        const bound = (bindings ?? []).filter(binding => binding.connection_id === connection.id).map(binding => binding.agent_id)
        const seen = bound.filter(sees)
        const slug = connection.app_slug as AppSlug
        return { slug, name: appInfo(slug).name, serviceSlug: appInfo(slug).serviceSlug, connectionId: connection.id, label: connection.label, status: connection.status as AppConnectionStatus, agentIds: seen, hiddenAgents: bound.length - seen.length }
    })
}

// What picking the account in the coworker's Apps tab does: the app's connector on the coworker if it
// has none yet, the binding, and the connector active.
export async function attachVaultPaidAccount(slug: AppSlug, connectionId: string, agentId: string, actor?: Actor): Promise<void> {
    const { actor: resolved } = await assertAgentAccess(agentId, 'manage', actor)
    const { serviceSlug } = appInfo(slug)
    await installService(agentId, serviceSlug, {}, undefined, resolved)
    await attachAgentToConnection(slug, agentId, connectionId)
    const label = (await vaultPaidAccounts(resolved)).find(account => account.connectionId === connectionId)?.label ?? undefined
    await markAppAuthorized(agentId, serviceSlug, label, resolved)
}

// The coworker stops acting with the account: its connector goes, which unbinds it. The account stays.
// A coworker already moved to another account of the app keeps it.
export async function detachVaultPaidAccount(slug: AppSlug, connectionId: string, agentId: string, actor?: Actor): Promise<void> {
    const { actor: resolved } = await assertAgentAccess(agentId, 'manage', actor)
    const supabase = createServiceRoleClient()
    const { data: binding } = await selectMaybeSingle(supabase, 'app_connection_agents', ['connection_id'] as const, { agent_id: agentId, app_slug: slug })
    if (binding?.connection_id !== connectionId) return
    await uninstallService(agentId, appInfo(slug).serviceSlug, resolved)
    // A binding whose connector was already gone outlives the uninstall: drop it here.
    await unbindAgent(supabase, resolved.workspaceId, agentId, slug)
}
