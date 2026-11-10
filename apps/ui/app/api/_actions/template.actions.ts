'use server'

import { isPublicStatus, type TemplateStatus } from '@rerun/contracts'
import { z } from 'zod'
import { assertAdminUser, getAdminEmail } from '@/lib/auth/admin'
import { assertSpaceAccess } from '@/app/api/_auth/access'
import { getServerSession } from '@/supabase/session/getServerSession'
import { loadServiceCatalog, type CatalogEntry } from '@/lib/templates/catalog'
import { hasTemplateEntitlement, templateAccessByWorkspace } from '@/lib/templates/entitlement'
import { loadCreatorDirectory, loadLibraryCreators } from '@/lib/templates/library-creators'
import { LIBRARY_COLUMNS, toLibraryTemplates, type LibraryCreator, type LibraryRow, type LibraryTemplate } from '@/lib/templates/library'
import { installTemplate, type TemplateInstallOutcome } from '@/lib/templates/install'
import type { GridPosition } from '@/lib/board/types'
import { AppError, failureOf, type ActionFailure } from '@/lib/i18n/action-error'
import { createClient } from '@/supabase/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

// The library is the app's recruiting surface, so everyone reads it: a visitor gets what is
// published and flagged for the library, an author also gets their own work whatever its status,
// and an admin gets everything, so a submission can be reviewed in the app before it is published.
// `unlisted` is deliberately absent from the public list — it stays reachable by its shared link,
// which is the whole point of the status. The read goes through the service role because
// `agent_archives` and `creator_id` sit outside the anon grant and everything private outside RLS,
// which is why the status filter is what enforces the rule here.
// What an admin is handed is not what an admin sees: the library shows them the public catalogue
// until they ask for a status, which is the client-side Status filter's job.
export async function listLibraryTemplatesAction(): Promise<LibraryTemplate[]> {
    const isAdmin = (await getAdminEmail()) !== null
    const { user } = await getServerSession()
    const supabase = createServiceRoleClient()
    const order = { column: 'published_at', ascending: false } as const

    // One read for the whole grid rather than one per card. A visitor with no workspace holds
    // nothing, so the map stays empty and every paid template reads as "not owned".
    const access = user?.workspace_id ? await templateAccessByWorkspace(supabase, user.workspace_id) : new Map()

    // Being an admin only widens the statuses read; everything else, their own templates included,
    // works the same for them as for anybody else.
    const statuses: TemplateStatus[] = isAdmin ? ['published', 'unlisted', 'in_review', 'draft'] : ['published']

    // Two reads rather than one: the filters are AND-ed dimension by dimension, so "published, or
    // mine whatever its status" has no single-filter form. Merged on the id, listed first wins.
    const [listed, mine] = await Promise.all([
        selectMany(supabase, 'templates', LIBRARY_COLUMNS, { status: statuses, show_in_library: true }, order),
        user?.id ? selectMany(supabase, 'templates', LIBRARY_COLUMNS, { creator_id: user.id }, order) : Promise.resolve({ data: [] }),
    ])
    const byId = new Map<string, LibraryRow>()
    for (const row of [...((listed.data ?? []) as LibraryRow[]), ...((mine.data ?? []) as LibraryRow[])]) byId.set(row.id, row)
    const rows = [...byId.values()]
    const creators = await loadLibraryCreators(supabase, rows.flatMap(row => (row.creator_id ? [row.creator_id] : [])))
    return toLibraryTemplates(rows, user?.id, access, creators)
}

// The creators the library introduces on Discover. Published fiches are public, but the read goes
// through the service role like the rest of the library: `accepted_at` sits outside the anon grant.
export async function listLibraryCreatorsAction(): Promise<LibraryCreator[]> {
    return loadCreatorDirectory(createServiceRoleClient())
}

// The New agent dialog draws its logos and searches by name over the whole catalog. Nothing here is
// private: `services` rows are the public catalog, hence the session client rather than the
// service role.
export async function listConnectorCatalogAction(): Promise<CatalogEntry[]> {
    const supabase = await createClient()
    return [...(await loadServiceCatalog(supabase)).values()]
}

// A shared template link is not a listing: `show_in_library` gates the in-app browser and has no
// say here, and an unlisted template is exactly the case this serves. The status filter is what
// enforces the rule, so an unpublished slug reads as "no longer available" rather than confirming
// it exists — unless the caller is the admin or its author, who both need to preview their own
// link. LIBRARY_COLUMNS reads `agent_archives` and `creator_id`, but toLibraryTemplates only keeps
// a length and a boolean, so neither the private bucket paths nor the author's id cross the wire.
export async function getSharedTemplateAction(slug: string): Promise<LibraryTemplate | null> {
    const parsed = z.string().trim().min(1).max(200).safeParse(slug)
    if (!parsed.success) return null
    const isAdmin = (await getAdminEmail()) !== null
    const { user } = await getServerSession()
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'templates', LIBRARY_COLUMNS, { slug: parsed.data })
    if (!data) return null
    const row = data as LibraryRow
    const isMine = !!user?.id && row.creator_id === user.id
    if (!isAdmin && !isMine && !isPublicStatus(row.status as TemplateStatus)) return null

    const [access, creators] = await Promise.all([user?.workspace_id ? templateAccessByWorkspace(supabase, user.workspace_id) : new Map(), loadLibraryCreators(supabase, row.creator_id ? [row.creator_id] : [])])
    return toLibraryTemplates([row], user?.id, access, creators)[0] ?? null
}

// The anchors are where the user dropped each agent, in the template's own install order. They are
// optional: a programmatic install still lets the server pick free cells.
const installInputSchema = z.object({
    slug: z.string().min(1),
    spaceId: z.string().uuid(),
    positions: z.array(z.object({ col: z.number().int(), row: z.number().int() })).optional(),
    again: z.boolean().optional(),
})

export type InstallTemplateResult = ({ ok: true } & TemplateInstallOutcome) | ActionFailure

// The target space comes from the client but its workspace never does: assertSpaceAccess resolves
// it from the session, so an id from somewhere else resolves to "Box not found". That check, at
// `manage` on the Box, is the write authorization; the template's status then decides who may copy it,
// since a shared link makes this reachable by anyone, not just the admin library.
export async function installTemplateAction(input: { slug: string; spaceId: string; positions?: GridPosition[]; again?: boolean }): Promise<InstallTemplateResult> {
    try {
        const { slug, spaceId, positions, again } = installInputSchema.parse(input)
        const { actor } = await assertSpaceAccess(spaceId, 'manage')
        const workspace_id = actor.workspaceId
        const supabase = createServiceRoleClient()

        const { data: template } = await selectMaybeSingle(supabase, 'templates', ['id', 'status', 'creator_id', 'pricing_model'] as const, { slug })
        if (!template) throw new AppError('templateSlugNotFound', { slug })

        // A live template installs for any member of the workspace; anything not yet public is a
        // preview, reserved for the admin and the author who is testing their own submission.
        // Unlike the rest of the app, entitlement is also checked here: this action lands paid
        // compute from an unauthenticated deep link, so UI-only gating would mean calling the
        // action by hand is enough to skip the paywall.
        if (!isPublicStatus(template.status as TemplateStatus)) {
            const { user } = await getServerSession()
            if (!user?.id || template.creator_id !== user.id) await assertAdminUser()
        } else if ((await getAdminEmail()) === null) {
            const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['subscription_status'] as const, { id: workspace_id })
            const status = workspace?.subscription_status
            if (status !== 'active' && status !== 'trialing') throw new AppError('noActivePlan')

            // The plan gate stays first: buying a template unlocks the template, not the compute
            // it needs to run.
            const { user } = await getServerSession()
            if (!(await hasTemplateEntitlement(supabase, workspace_id, template, user?.id))) throw new AppError('templateNeedsPurchase')
        }

        const outcome = await installTemplate(supabase, slug, { workspaceId: workspace_id, spaceId, actor, positions, again })
        return { ok: true, ...outcome }
    } catch (err) {
        return failureOf(err, 'importTemplateFailed')
    }
}
