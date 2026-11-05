'use server'

import type { Database } from '@/app/api/database.types'
import { AuthorizationError, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { hasPendingCreatorTerms, isExpertAccount, requireSandboxWorkspaceId } from '@/app/api/_auth/expert'
import { BASE_PLAN_SLUG, baseLimitsToColumns, SIGNUP_BUDGET_MICROS } from '@/cloud/billing'
import { grantRerunTopup } from '@/cloud/billing.server'
import { BLOB_ILLUSTRATIONS, getBlobByFile, randomBlob } from '@/lib/blobs/catalog'
import { uploadPublicImage } from '@/lib/images/upload'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { enterSandbox, ensureSandboxSpace } from '@/app/api/_services/sandbox.service'
import { readFirstName } from '@/lib/naming/first-name'
import { WORKSPACE_NAME_MAX, workspaceNameFrom } from '@/lib/naming/workspace-name'
import { fetchLogoBytes, rasterizeVectorLogo } from '@/lib/workspace/fetch-logo'
import { LOGO_MAX_BYTES, LOGO_TOO_LARGE, logoLinkImageUrl, NO_LOGO_FOUND, readLogoLink } from '@/lib/workspace/logo-input'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectSingle } from '@/supabase/supabase-helpers'

import type { ActionResult } from './space.actions'

async function requireUserId(): Promise<string> {
    const { user } = await getServerSession()
    if (!user?.id) throw new AuthorizationError('Not authenticated')
    return user.id
}

// Sets the caller's active workspace. The active workspace is `users.workspace_id`,
// which scopes the UI and the service-role API layer. We only allow switching to a
// workspace the caller is actually a member of.
export async function switchWorkspaceAction(workspaceId: number): Promise<ActionResult> {
    const userId = await requireUserId()
    const supabase = createServiceRoleClient()

    const { data: membership } = await selectSingle(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId, workspace_id: workspaceId })
    if (!membership) return { ok: false, error: 'You are not a member of this workspace' }

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
    const { workspace, supabase } = await requireWorkspaceContext()

    const name = String(formData.get('name') ?? '').trim()
    if (!name) return { ok: false, error: 'Name is required' }
    if (name.length > WORKSPACE_NAME_MAX) return { ok: false, error: `Keep the name under ${WORKSPACE_NAME_MAX} characters` }

    const logo = await readLogo(formData, workspace.id)
    if (!logo.ok) return logo

    const { error } = await supabase
        .from('workspaces')
        .update<Database['public']['Tables']['workspaces']['Update']>({ name, ...(logo.iconUrl ? { icon_url: logo.iconUrl } : {}) })
        .eq('id', workspace.id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}

const WORKSPACE_LOGOS_BUCKET = 'workspace-logos'
const WORKSPACE_LOGO_MAX_SIZE = 256

async function readLogo(formData: FormData, workspaceId: number): Promise<ActionResult<{ iconUrl?: string }>> {
    const iconFile = formData.get('iconFile')
    if (typeof iconFile === 'string' && iconFile) {
        const icon = getBlobByFile(iconFile)
        return icon ? { ok: true, iconUrl: icon.url } : { ok: false, error: 'Unknown icon' }
    }

    const logoFile = formData.get('logoFile')
    if (logoFile instanceof File) {
        if (!logoFile.type.startsWith('image/')) return { ok: false, error: 'Please choose an image file.' }
        if (logoFile.size > LOGO_MAX_BYTES) return { ok: false, error: LOGO_TOO_LARGE }
        return rehostLogo(await logoFile.arrayBuffer(), workspaceId)
    }

    const logoLink = formData.get('logoLink')
    if (typeof logoLink === 'string' && logoLink.trim()) {
        const link = readLogoLink(logoLink)
        if (!link) return { ok: false, error: NO_LOGO_FOUND }
        const fetched = await fetchLogoBytes(logoLinkImageUrl(link))
        if (!fetched.ok) return fetched
        return rehostLogo(fetched.bytes, workspaceId)
    }

    return { ok: true }
}

async function rehostLogo(bytes: ArrayBuffer | Uint8Array, workspaceId: number): Promise<ActionResult<{ iconUrl: string }>> {
    try {
        const raster = await rasterizeVectorLogo(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), WORKSPACE_LOGO_MAX_SIZE)
        const iconUrl = await uploadPublicImage(createServiceRoleClient(), raster, WORKSPACE_LOGOS_BUCKET, String(workspaceId), { maxSize: WORKSPACE_LOGO_MAX_SIZE })
        return { ok: true, iconUrl }
    } catch {
        return { ok: false, error: 'That image could not be read.' }
    }
}

// Creates a new workspace owned by the caller, adds the owner membership, and
// makes it the active workspace.
export async function createWorkspaceAction(name: string, iconUrl?: string): Promise<ActionResult<{ workspaceId: number }>> {
    const userId = await requireUserId()
    const icon = iconUrl ? BLOB_ILLUSTRATIONS.find(blob => blob.url === iconUrl) : undefined
    if (iconUrl && !icon) return { ok: false, error: 'Unknown icon' }
    const { session, workspace: current } = await getServerSession()
    const supabase = createServiceRoleClient()

    const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .insert<Database['public']['Tables']['workspaces']['Insert']>({
            name: name.trim() || workspaceNameFrom({ firstName: readFirstName(session?.user_metadata) }),
            icon_url: icon?.url ?? randomBlob()?.url ?? null,
            plan: BASE_PLAN_SLUG,
            ...baseLimitsToColumns(),
            // No subscription behind this workspace yet, so no monthly budget either: the plan's
            // budget lands when the plan does. It starts on the signup allowance, granted below.
            rerun_budget_micros: 0,
            // One person is quoted one price, whichever of their workspaces they stand in.
            price_arm: current?.price_arm ?? null,
        })
        .select('id')
        .single()

    if (workspaceError || !workspace) return { ok: false, error: workspaceError?.message ?? 'Failed to create workspace' }

    const workspaceId = (workspace as { id: number }).id

    const { error: membershipError } = await supabase.from('workspace_members').insert<Database['public']['Tables']['workspace_members']['Insert']>({
        user_id: userId,
        workspace_id: workspaceId,
    })
    if (membershipError) return { ok: false, error: membershipError.message }

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

    if (!(await isExpertAccount(userId))) return { ok: false, error: 'The sandbox is reserved for expert accounts.' }
    // The creator flow claims the sandbox itself, before the conditions screen. Everywhere else the
    // wall holds: no switching into a sandbox whose program conditions are still unsigned.
    if (await hasPendingCreatorTerms(userId)) return { ok: false, error: 'Accept the creator program conditions to open your sandbox.' }

    return enterSandbox(userId)
}

// Restores the sandbox invariant — an active sandbox always has its Space — for a caller who is
// already inside it: a reload lands straight on `users.workspace_id` without going through the
// switcher, so enterSandboxAction never gets a chance to re-claim an engine.
export async function ensureSandboxSpaceAction(): Promise<ActionResult | { ok: false; error: string; locked: true }> {
    const workspaceId = await requireSandboxWorkspaceId()
    return (await ensureSandboxSpace(workspaceId)) ?? { ok: true }
}
