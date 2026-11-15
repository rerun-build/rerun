'use server'

import { isMachineEntitled } from '@rerun/cloud/billing'
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

export async function listLibraryTemplatesAction(): Promise<LibraryTemplate[]> {
    const isAdmin = (await getAdminEmail()) !== null
    const { user } = await getServerSession()
    const supabase = createServiceRoleClient()
    const order = { column: 'published_at', ascending: false } as const

    const access = user?.workspace_id ? await templateAccessByWorkspace(supabase, user.workspace_id) : new Map()

    const statuses: TemplateStatus[] = isAdmin ? ['published', 'unlisted', 'in_review', 'draft'] : ['published']

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

export async function listLibraryCreatorsAction(): Promise<LibraryCreator[]> {
    return loadCreatorDirectory(createServiceRoleClient())
}

export async function listConnectorCatalogAction(): Promise<CatalogEntry[]> {
    const supabase = await createClient()
    return [...(await loadServiceCatalog(supabase)).values()]
}

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

const installInputSchema = z.object({
    slug: z.string().min(1),
    spaceId: z.string().uuid(),
    positions: z.array(z.object({ col: z.number().int(), row: z.number().int() })).optional(),
    again: z.boolean().optional(),
})

export type InstallTemplateResult = ({ ok: true } & TemplateInstallOutcome) | ActionFailure

export async function installTemplateAction(input: { slug: string; spaceId: string; positions?: GridPosition[]; again?: boolean }): Promise<InstallTemplateResult> {
    try {
        const { slug, spaceId, positions, again } = installInputSchema.parse(input)
        const { actor } = await assertSpaceAccess(spaceId, 'manage')
        const workspace_id = actor.workspaceId
        const supabase = createServiceRoleClient()

        const { data: template } = await selectMaybeSingle(supabase, 'templates', ['id', 'status', 'creator_id', 'pricing_model'] as const, { slug })
        if (!template) throw new AppError('templateSlugNotFound', { slug })

        if (!isPublicStatus(template.status as TemplateStatus)) {
            const { user } = await getServerSession()
            if (!user?.id || template.creator_id !== user.id) await assertAdminUser()
        } else if ((await getAdminEmail()) === null) {
            const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['subscription_status'] as const, { id: workspace_id })
            if (!isMachineEntitled(workspace?.subscription_status)) throw new AppError('noActivePlan')

            const { user } = await getServerSession()
            if (!(await hasTemplateEntitlement(supabase, workspace_id, template, user?.id))) throw new AppError('templateNeedsPurchase')
        }

        const outcome = await installTemplate(supabase, slug, { workspaceId: workspace_id, spaceId, actor, positions, again })
        return { ok: true, ...outcome }
    } catch (err) {
        return failureOf(err, 'importTemplateFailed')
    }
}
