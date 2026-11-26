import { isPublicStatus, type TemplateStatus } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { AppError } from '@/lib/i18n/action-error'
import { hasTemplateEntitlement } from '@/lib/templates/entitlement'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// `isPlatformAdmin`: a member of the Rerun team, who previews any template and installs without a plan.
export type TemplateInstaller = { workspaceId: number; userId: string | null; isPlatformAdmin: boolean }

// Who may copy a template, whoever asks (the app, a deep link, an API key). A live template installs
// for any member of a workspace with a plan; anything not yet public is a preview, reserved for the
// Rerun team and the author testing their own submission. Entitlement is checked here rather than in
// the UI: an install lands paid compute, so calling it by hand must not be enough to skip the paywall.
export async function assertTemplateInstallable(supabase: SupabaseClient<Database>, slug: string, installer: TemplateInstaller): Promise<void> {
    const { data: template } = await selectMaybeSingle(supabase, 'templates', ['id', 'status', 'creator_id', 'pricing_model'] as const, { slug })
    if (!template) throw new AppError('templateSlugNotFound', { slug })

    if (!isPublicStatus(template.status as TemplateStatus)) {
        if (installer.isPlatformAdmin || (installer.userId !== null && template.creator_id === installer.userId)) return
        throw new Error('Unauthorized')
    }
    if (installer.isPlatformAdmin) return

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['subscription_status', 'organization_id'] as const, { id: installer.workspaceId })
    const status = workspace?.subscription_status
    if (status !== 'active' && status !== 'trialing') throw new AppError(isManagedWorkspace(workspace) ? 'managedWorkspacePaused' : 'noActivePlan')

    // The plan gate stays first: buying a template unlocks the template, not the compute it needs to run.
    if (!(await hasTemplateEntitlement(supabase, installer.workspaceId, template, installer.userId))) throw new AppError('templateNeedsPurchase')
}
