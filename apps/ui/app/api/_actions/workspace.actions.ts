'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { AuthorizationError, requireAdminContext, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { hasPendingCreatorTerms, isExpertAccount, requireSandboxWorkspaceId } from '@/app/api/_auth/expert'
import { BASE_PLAN_SLUG, baseLimitsToColumns, SIGNUP_BUDGET_MICROS } from '@rerun/cloud/billing'
import { grantRerunTopup } from '@rerun/cloud/billing.server'
import { BLOB_ILLUSTRATIONS, randomBlob } from '@/lib/blobs/catalog'
import { requestHostScope } from '@/lib/brand/host-scope'
import { isRerunHost } from '@/lib/brand/request-site'
import { opensOnHost } from '@/lib/workspace/host-workspace'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { enterSandbox, ensureSandboxSpace } from '@/app/api/_services/sandbox.service'
import { accountFirstName } from '@/lib/naming/account-first-name'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { WORKSPACE_NAME_MAX, workspaceNameFrom } from '@/lib/naming/workspace-name'
import { readWorkspaceLogo } from '@/lib/workspace/read-logo'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'

import { applyCoworkerLanguage } from '@/app/api/_services/coworker-language.service'
import { isStableLocale } from '@rerun/i18n'
import { failure } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'
import { ensureForemanAgentRow } from '@/lib/foreman/agent-row'

async function requireUserId(): Promise<string> {
    const { user } = await getServerSession()
    if (!user?.id) throw new AuthorizationError('notAuthenticated')
    return user.id
}

// A workspace another host opens answers like one they are not in.
async function opensHere(supabase: SupabaseClient<Database>, workspaceId: number): Promise<boolean> {
    const scope = await requestHostScope()
    if (!scope) return true
    const { data } = await selectMaybeSingle(supabase, 'workspaces', ['organization_id'] as const, { id: workspaceId })
    return opensOnHost(scope, data?.organization_id ?? null)
}

// Sets the caller's active workspace. The active workspace is `users.workspace_id`,
// which scopes the UI and the service-role API layer. We only allow switching to a
// workspace the caller is actually a member of.
export async function switchWorkspaceAction(workspaceId: number): Promise<ActionResult> {
    const userId = await requireUserId()
    const supabase = createServiceRoleClient()

    const { data: membership } = await selectSingle(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId, workspace_id: workspaceId })
    if (!membership) return failure('notMember')
    if (!(await opensHere(supabase, workspaceId))) return failure('notMember')

    const { error } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: workspaceId }).eq('id', userId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}

// Renames the workspace, and swaps its logo when one was picked. The name rides on every invitation
// email, so it is not a preference each member holds their own version of.
//
// The logo arrives as a catalogue file name, an uploaded file or a link, never as a URL to store:
// `icon_url` is rendered as a bare <img>, down to anonymous pages, so a file or a link is fetched and
// re-hosted in our bucket here, and only that address is written.
export async function updateWorkspaceAction(formData: FormData): Promise<ActionResult> {
    const ctx = await requireAdminContext('adminOnlySettings').catch((err: unknown) => {
        if (err instanceof AuthorizationError) return err
        throw err
    })
    if (ctx instanceof AuthorizationError) return failure(ctx.code, ctx.params)
    const { workspace, supabase } = ctx

    const name = String(formData.get('name') ?? '').trim()
    if (!name) return failure('nameRequired')
    if (name.length > WORKSPACE_NAME_MAX) return failure('nameTooLong', { max: WORKSPACE_NAME_MAX })

    const locale = formData.get('locale')
    if (locale !== null && !isStableLocale(locale)) return failure('unknownLanguage')

    const logo = await readWorkspaceLogo(formData, workspace.id)
    if (!logo.ok) return logo

    const { error } = await supabase
        .from('workspaces')
        .update<Database['public']['Tables']['workspaces']['Update']>({ name, ...(logo.iconUrl ? { icon_url: logo.iconUrl } : {}), ...(locale ? { locale } : {}) })
        .eq('id', workspace.id)
    if (error) return { ok: false, error: error.message }
    if (locale) await applyCoworkerLanguage(createServiceRoleClient(), workspace.id, locale)
    return { ok: true }
}

// Creates a new workspace owned by the caller, adds the owner membership, and
// makes it the active workspace.
export async function createWorkspaceAction(name: string, iconUrl?: string): Promise<ActionResult<{ workspaceId: number }>> {
    const userId = await requireUserId()
    const { session, workspace: current } = await getServerSession()
    // The organization opens the workspaces of its clients.
    if (isManagedWorkspace(current) || !(await isRerunHost())) return failure('managedWorkspace')
    const icon = iconUrl ? BLOB_ILLUSTRATIONS.find(blob => blob.url === iconUrl) : undefined
    if (iconUrl && !icon) return failure('unknownIcon')
    const supabase = createServiceRoleClient()

    const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .insert<Database['public']['Tables']['workspaces']['Insert']>({
            name: name.trim() || workspaceNameFrom({ firstName: await accountFirstName(session) }),
            icon_url: icon?.url ?? randomBlob()?.url ?? null,
            plan: BASE_PLAN_SLUG,
            ...baseLimitsToColumns(),
            // No subscription behind this workspace yet, so no monthly budget either: the plan's
            // budget lands when the plan does. It starts on the signup allowance, granted below.
            rerun_budget_micros: 0,
        })
        .select('id')
        .single()

    if (workspaceError || !workspace) return workspaceError ? { ok: false, error: workspaceError.message } : failure('createWorkspaceFailed')

    const workspaceId = (workspace as { id: number }).id

    const { error: membershipError } = await supabase.from('workspace_members').insert<Database['public']['Tables']['workspace_members']['Insert']>({
        user_id: userId,
        workspace_id: workspaceId,
        role: 'admin',
    })
    if (membershipError) return { ok: false, error: membershipError.message }

    // Never blocks the workspace: a row missing here is written the first time it is needed.
    await ensureForemanAgentRow(supabase, workspaceId).catch(err => console.error('[workspace] failed to write the Chief of Staff', err))

    // Without it the workspace starts at zero and its trial adds nothing: every Rerun model answers
    // "credits used up" on the first message, though none was ever used.
    await grantRerunTopup(workspaceId, SIGNUP_BUDGET_MICROS)

    const { error: switchError } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: workspaceId }).eq('id', userId)
    if (switchError) return { ok: false, error: switchError.message }

    return { ok: true, workspaceId }
}

// Enters the caller's sandbox, creating it on first use. Restricted to expert accounts server-side —
// the switcher gate is only cosmetic.
export async function enterSandboxAction(): Promise<ActionResult<{ workspaceId: number }>> {
    const userId = await requireUserId()

    if (!(await isRerunHost())) return failure('sandboxExpertOnly')
    if (!(await isExpertAccount(userId))) return failure('sandboxExpertOnly')
    // The creator flow claims the sandbox itself, before the conditions screen. Everywhere else the
    // wall holds: no switching into a sandbox whose program conditions are still unsigned.
    if (await hasPendingCreatorTerms(userId)) return failure('acceptCreatorTermsFirst')

    return enterSandbox(userId)
}

// Restores the sandbox invariant — an active sandbox always has its Space — for a caller who is
// already inside it: a reload lands straight on `users.workspace_id` without going through the
// switcher, so enterSandboxAction never gets a chance to re-claim an engine.
export async function ensureSandboxSpaceAction(): Promise<ActionResult | { ok: false; error: string; locked: true }> {
    const workspaceId = await requireSandboxWorkspaceId()
    return (await ensureSandboxSpace(workspaceId)) ?? { ok: true }
}
