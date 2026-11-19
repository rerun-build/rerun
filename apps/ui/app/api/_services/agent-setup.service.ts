import type { Actor } from '@/app/api/_auth/access'
import { compileService } from '@/lib/services/compiler'
import { type ServiceManifest, autoInstallableMethod, serviceManifestSchema } from '@/lib/services/manifest'
import type { ServiceChecklistItem } from '@/lib/services/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import type { CoworkerLook } from '@rerun/contracts'
import { selectSingle } from '@/supabase/supabase-helpers'
import { createAgent } from './agent.service'
import { type ServiceInstanceSeed, markServiceNeedsConfig, toAuthMethodSummaries } from './services.service'

// Install each catalog service onto an agent. Services with required secrets can't be
// auto-supplied, so they're marked needs_config and returned in the checklist for the user
// to finish; the rest are compiled immediately. Unknown/disabled slugs are skipped.
export async function installServiceSlugs(agentId: string, slugs: string[], actor?: Actor): Promise<ServiceChecklistItem[]> {
    const supabase = createServiceRoleClient()
    const checklist: ServiceChecklistItem[] = []
    for (const slug of slugs) {
        const { data: svc } = await selectSingle(supabase, 'services', ['manifest', 'enabled'] as const, { slug })
        if (!svc || !svc.enabled) continue
        const manifest = serviceManifestSchema.parse(svc.manifest)
        const declared = await declareService(agentId, manifest, actor)
        if (declared === 'needs_config') checklist.push({ slug: manifest.slug, name: manifest.name, authMethods: toAuthMethodSummaries(manifest) })
    }
    return checklist
}

// Auto-install only when there's no choice to make: a single method with no required secrets
// (pure OAuth / skill-only). Anything else (secrets, or multiple methods) is deferred to the
// finish-setup wizard so the user picks a method and fills it in. `instance` declares another
// account of the app instead of its base one.
export async function declareService(agentId: string, manifest: ServiceManifest, actor?: Actor, instance?: ServiceInstanceSeed): Promise<'compiled' | 'needs_config'> {
    const method = autoInstallableMethod(manifest)
    if (method) {
        await compileService(agentId, manifest, {}, method.id, actor, instance)
        return 'compiled'
    }
    await markServiceNeedsConfig(agentId, instance?.key ?? manifest.slug, undefined, actor, instance ? { instanceId: instance.instanceId, label: instance.label } : undefined)
    return 'needs_config'
}

// Create an agent and install the services the user picked. Services with required secrets
// can't be auto-supplied, so they are marked needs_config and returned in the checklist for
// the user to finish configuring.
export async function createAgentWithSetup(params: { name: string; description?: string; look?: CoworkerLook; serviceSlugs?: string[]; workspaceId: number; spaceId: string; actor: Actor; col?: number; row?: number }): Promise<{ agentId: string; active: boolean; checklist: ServiceChecklistItem[] }> {
    const agent = await createAgent({
        name: params.name,
        description: params.description,
        look: params.look,
        workspaceId: params.workspaceId,
        spaceId: params.spaceId,
        actor: params.actor,
        position: typeof params.col === 'number' && typeof params.row === 'number' ? { col: params.col, row: params.row } : undefined,
    })

    const checklist = await installServiceSlugs(agent.id, params.serviceSlugs ?? [], params.actor)

    return { agentId: agent.id, active: !agent.disabled_at, checklist }
}
