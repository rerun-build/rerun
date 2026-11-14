'use server'

import { assertAgentAccess, assertSpaceAccess } from '@/app/api/_auth/access'
import { createAgentWithSetup } from '@/app/api/_services/agent-setup.service'
import { getCatalogServicesBySlugs, getServiceAlternatives, getServiceDetails, installService, listCatalogServices, markServiceAuthorized, resetServiceConnection, searchServices, uninstallService } from '@/app/api/_services/services.service'
import type { InstallResult, ResetConnectionResult, ServiceAlternative, ServiceChecklistItem, ServiceDetails, ServiceSearchResult } from '@/lib/services/types'
import { failureOf, refusalOf, type ActionFailure, type SuccessResult } from '@/lib/i18n/action-error'

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

export async function searchServicesAction(agentId: string, query?: string, category?: string): Promise<ServiceSearchResult[]> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'use')
        const { results } = await searchServices(agentId, query, category, actor)
        return results
    } catch {
        return []
    }
}

export async function listCatalogServicesAction(opts?: { category?: string; limit?: number; offset?: number }): Promise<ServiceSearchResult[]> {
    try {
        return await listCatalogServices(opts)
    } catch {
        return []
    }
}

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

export async function markServiceAuthorizedAction(agentId: string, key: string): Promise<{ success: boolean }> {
    try {
        const { actor } = await assertAgentAccess(agentId, 'manage')
        await markServiceAuthorized(agentId, key, actor)
        return { success: true }
    } catch {
        return { success: false }
    }
}

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

export async function createAgentWithSetupAction(params: { name: string; description?: string; serviceSlugs?: string[]; workspaceId: number; spaceId: string; col?: number; row?: number }): Promise<{ ok: true; agentId: string; active: boolean; checklist: ServiceChecklistItem[] } | ActionFailure> {
    try {
        const { actor } = await assertSpaceAccess(params.spaceId, 'manage')
        const { agentId, active, checklist } = await createAgentWithSetup({ ...params, workspaceId: actor.workspaceId, actor })
        return { ok: true, agentId, active, checklist }
    } catch (err) {
        return failureOf(err, 'createCoworkerFailed')
    }
}
