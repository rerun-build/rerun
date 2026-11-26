import 'server-only'

import { assertSpaceAccess, type Actor } from '@/app/api/_auth/access'
import { asString, requireString } from '@/lib/mcp/args'
import { MAX_LIBRARY_RESULTS } from '@/lib/mcp/library-tools'
import { templateAccessByWorkspace } from '@/lib/templates/entitlement'
import { installTemplate } from '@/lib/templates/install'
import { assertTemplateInstallable } from '@/lib/templates/install-guard'
import { LIBRARY_COLUMNS, toLibraryTemplates, type LibraryRow, type LibraryTemplate } from '@/lib/templates/library'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { dispatchVaultTool } from './mcp-vault.service'

function templateView(template: LibraryTemplate) {
    return {
        slug: template.slug,
        title: template.title,
        tagline: template.tagline,
        category: template.category,
        coworkers: template.archiveAgentNames,
        apps: template.connectors.map(connector => connector.slug),
        setupMinutes: template.setupMinutes,
        pricing: template.pricing,
        owned: template.owned,
    }
}

const userOf = (actor: Actor) => (actor.kind === 'user' ? actor.userId : null)

// As the library shows it to this workspace: what can be installed (a template with coworkers to
// copy), and for a workspace an organization manages, only what it already holds.
async function searchLibrary(actor: Actor, args: Record<string, unknown>) {
    const supabase = createServiceRoleClient()
    const category = asString(args.category)
    const query = asString(args.query)?.toLowerCase()
    const [{ data }, access, { data: workspace }] = await Promise.all([
        selectMany(supabase, 'templates', LIBRARY_COLUMNS, { status: 'published', show_in_library: true }, { column: 'published_at', ascending: false }),
        templateAccessByWorkspace(supabase, actor.workspaceId),
        selectMaybeSingle(supabase, 'workspaces', ['organization_id'] as const, { id: actor.workspaceId }),
    ])
    const managed = isManagedWorkspace(workspace)
    const matching = toLibraryTemplates((data ?? []) as LibraryRow[], userOf(actor), access)
        .filter(template => template.archiveAgentNames.length > 0 && (!managed || template.owned))
        .filter(template => !category || template.category === category)
        .filter(template => !query || `${template.title} ${template.tagline} ${template.tags.join(' ')}`.toLowerCase().includes(query))
        .sort((a, b) => Number(b.featured) - Number(a.featured))
    return { templates: matching.slice(0, MAX_LIBRARY_RESULTS).map(templateView), total: matching.length }
}

// The checks of the app's own install, with the Box first: an id from another workspace reads as
// "Box not found" before anything about the template is said.
async function install(actor: Actor, args: Record<string, unknown>) {
    const slug = requireString(args.slug, 'slug')
    const spaceId = requireString(args.spaceId, 'spaceId')
    await assertSpaceAccess(spaceId, 'manage', actor)
    const supabase = createServiceRoleClient()
    await assertTemplateInstallable(supabase, slug, { workspaceId: actor.workspaceId, userId: userOf(actor), isPlatformAdmin: false })
    const outcome = await installTemplate(supabase, slug, { workspaceId: actor.workspaceId, spaceId, actor })
    return {
        installed: outcome.imported,
        inactive: outcome.inactive,
        agentIds: outcome.agentIds,
        ...(outcome.alreadyInstalled ? { alreadyInstalled: true, note: 'This template was already installed in the workspace: these are its coworkers.' } : {}),
        ...(outcome.failed.length > 0 ? { failed: outcome.failed } : {}),
        ...(outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {}),
    }
}

// Chained after the published pages: the Vault comes next.
export async function dispatchLibraryTool(actor: Actor, name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
        case 'search_template_library':
            return searchLibrary(actor, args)
        case 'install_template':
            return install(actor, args)
        default:
            return await dispatchVaultTool(actor, name, args)
    }
}
