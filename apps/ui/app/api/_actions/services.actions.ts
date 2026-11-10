'use server'

import { assertAgentAccess, assertSpaceAccess } from '@/app/api/_auth/access'
import { createAgentWithSetup } from '@/app/api/_services/agent-setup.service'
import { getCatalogServicesBySlugs, getServiceAlternatives, getServiceDetails, installService, listCatalogServices, markServiceAuthorized, resetServiceConnection, searchServices, uninstallService } from '@/app/api/_services/services.service'
import type { InstallResult, ResetConnectionResult, ServiceAlternative, ServiceChecklistItem, ServiceDetails, ServiceSearchResult } from '@/lib/services/types'
import { failureOf, refusalOf, type ActionFailure, type SuccessResult } from '@/lib/i18n/action-error'

// Install (or configure) a service on an agent. Used by both the chat config form and
// the Services settings tab — the same compile path either way. Returns needs_config
// (without compiling) when required inputs are still missing. `key` is a slug for the base
// account or `slug@id` for another one; `newInstance` adds a fresh account.
export async function installServiceAction(
    agentId: string,
    key: string,
    values: Record<string, string>,
    authMethodId?: string,
    opts?: { newInstance?: boolean },
): Promise<{ ok: true; result: InstallResult } | ActionFailure> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'manage')
        const result = await installService(agentId, key, values, authMethodId, actor, opts)
        return { ok: true, result }
    } catch (err) {
        return failureOf(err, 'installServiceFailed')
    }
}

// Browse the library (optionally filtered). `installed` is resolved per agent.
export async function searchServicesAction(agentId: string, query?: string, category?: string): Promise<ServiceSearchResult[]> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'use')
        const { results } = await searchServices(agentId, query, category, actor)
        return results
    } catch {
        return []
    }
}

// Browse the global catalog with no agent context (agent-creation dialog). Paginated so it
// scales past 1000 services; `installed` is always false and selection is applied at creation
// via createAgentWithSetupAction. Free-text lookup uses searchCatalogServicesAction instead.
export async function listCatalogServicesAction(opts?: { category?: string; limit?: number; offset?: number }): Promise<ServiceSearchResult[]> {
    try {
        return await listCatalogServices(opts)
    } catch {
        return []
    }
}

// Resolve full catalog metadata for specific slugs (agent-creation dialog tile cache, e.g.
// the finish-setup checklist whose services may lie outside the loaded browse pages).
export async function getCatalogServicesBySlugsAction(slugs: string[]): Promise<ServiceSearchResult[]> {
    try {
        return await getCatalogServicesBySlugs(slugs)
    } catch {
        return []
    }
}

export async function getServiceAlternativesAction(slugs: string[]): Promise<Record<string, ServiceAlternative[]>> {
    try {
        return await getServiceAlternatives(slugs)
    } catch {
        return {}
    }
}

export async function getServiceDetailsAction(agentId: string, key: string): Promise<ServiceDetails | null> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'use')
        return await getServiceDetails(agentId, key, actor)
    } catch {
        return null
    }
}

// Flip an OAuth service to active after the user finishes the sign-in popup.
export async function markServiceAuthorizedAction(agentId: string, key: string): Promise<{ success: boolean }> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'manage')
        await markServiceAuthorized(agentId, key, actor)
        return { success: true }
    } catch {
        return { success: false }
    }
}

// Reset a connected service so the user can go through its sign-in (or its config) again.
// Non-destructive: nothing the install compiled is removed, only the stored token.
export async function resetServiceConnectionAction(agentId: string, key: string): Promise<{ ok: true; result: ResetConnectionResult } | ActionFailure> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'manage')
        return { ok: true, result: await resetServiceConnection(agentId, key, actor) }
    } catch (err) {
        return failureOf(err, 'resetAppFailed')
    }
}

export async function uninstallServiceAction(agentId: string, key: string): Promise<SuccessResult> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'manage')
        await uninstallService(agentId, key, actor)
        return { success: true }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'uninstallServiceFailed') }
    }
}

// --- Agent creation ---

// Create the agent and install the services the user picked, all at drop. Services that
// need secrets come back in the checklist for the user to finish configuring.
export async function createAgentWithSetupAction(params: { name: string; description?: string; serviceSlugs?: string[]; workspaceId: number; spaceId: string; col?: number; row?: number }): Promise<{ ok: true; agentId: string; active: boolean; checklist: ServiceChecklistItem[] } | ActionFailure> {
    try {
        const { actor } = await assertSpaceAccess(params.spaceId, 'manage')
        const { agentId, active, checklist } = await createAgentWithSetup({ ...params, workspaceId: actor.workspaceId, actor })
        return { ok: true, agentId, active, checklist }
    } catch (err) {
        return failureOf(err, 'createCoworkerFailed')
    }
}
