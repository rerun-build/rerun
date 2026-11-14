'use server'

import type { Database } from '@/app/api/database.types'
import { AuthorizationError, requireAdminContext, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { hasPendingCreatorTerms, isExpertAccount, requireSandboxWorkspaceId } from '@/app/api/_auth/expert'
import { BASE_PLAN_SLUG, baseLimitsToColumns, SIGNUP_BUDGET_MICROS } from '@rerun/cloud/billing'
import { grantRerunTopup } from '@rerun/cloud/billing.server'
import { BLOB_ILLUSTRATIONS, getBlobByFile, randomBlob } from '@/lib/blobs/catalog'
import { uploadPublicImage } from '@/lib/images/upload'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { enterSandbox, ensureSandboxSpace } from '@/app/api/_services/sandbox.service'
import { readFirstName } from '@/lib/naming/first-name'
import { WORKSPACE_NAME_MAX, workspaceNameFrom } from '@/lib/naming/workspace-name'
import { findSiteIcon } from '@/lib/onboarding/site-icon.server'
import { fetchLogoBytes, rasterizeVectorLogo } from '@/lib/workspace/fetch-logo'
import { LOGO_MAX_BYTES, logoLinkImageUrl, readLogoLink } from '@/lib/workspace/logo-input'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectSingle } from '@/supabase/supabase-helpers'

import { applyCoworkerLanguage } from '@/app/api/_services/coworker-language.service'
import { isStableLocale } from '@rerun/i18n'
import { failure } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'

async function requireUserId(): Promise<string> {
    const { user } = await getServerSession()
    if (!user?.id) throw new AuthorizationError('notAuthenticated')
    return user.id
}

export async function switchWorkspaceAction(workspaceId: number): Promise<ActionResult> {
    const userId = await requireUserId()
    const supabase = createServiceRoleClient()

    const { data: membership } = await selectSingle(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId, workspace_id: workspaceId })
    if (!membership) return failure('notMember')

    const { error } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: workspaceId }).eq('id', userId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}

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

    const logo = await readLogo(formData, workspace.id)
    if (!logo.ok) return logo

    const { error } = await supabase
        .from('workspaces')
        .update<Database['public']['Tables']['workspaces']['Update']>({ name, ...(logo.iconUrl ? { icon_url: logo.iconUrl } : {}), ...(locale ? { locale } : {}) })
        .eq('id', workspace.id)
    if (error) return { ok: false, error: error.message }
    if (locale) await applyCoworkerLanguage(createServiceRoleClient(), workspace.id, locale)
    return { ok: true }
}

const WORKSPACE_LOGOS_BUCKET = 'workspace-logos'
const WORKSPACE_LOGO_MAX_SIZE = 256

async function readLogo(formData: FormData, workspaceId: number): Promise<ActionResult<{ iconUrl?: string }>> {
    const iconFile = formData.get('iconFile')
    if (typeof iconFile === 'string' && iconFile) {
        const icon = getBlobByFile(iconFile)
        return icon ? { ok: true, iconUrl: icon.url } : failure('unknownIcon')
    }

    const logoFile = formData.get('logoFile')
    if (logoFile instanceof File) {
        if (!logoFile.type.startsWith('image/')) return failure('chooseImage')
        if (logoFile.size > LOGO_MAX_BYTES) return failure('imageTooLarge', { max: LOGO_MAX_BYTES / (1024 * 1024) })
        return rehostLogo(await logoFile.arrayBuffer(), workspaceId)
    }

    const logoLink = formData.get('logoLink')
    if (typeof logoLink === 'string' && logoLink.trim()) {
        const link = readLogoLink(logoLink)
        if (!link) return failure('noLogoFound')
        if (link.kind === 'site') {
            const icon = await findSiteIcon(link.domain)
            return icon ? rehostLogo(icon.bytes, workspaceId) : failure('noLogoFound')
        }
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
        return failure('imageUnreadable')
    }
}

export async function createWorkspaceAction(name: string, iconUrl?: string): Promise<ActionResult<{ workspaceId: number }>> {
    const userId = await requireUserId()
    const icon = iconUrl ? BLOB_ILLUSTRATIONS.find(blob => blob.url === iconUrl) : undefined
    if (iconUrl && !icon) return failure('unknownIcon')
    const { session, workspace: current } = await getServerSession()
    const supabase = createServiceRoleClient()

    const { data: workspace, error: workspaceError } = await supabase
        .from('workspaces')
        .insert<Database['public']['Tables']['workspaces']['Insert']>({
            name: name.trim() || workspaceNameFrom({ firstName: readFirstName(session?.user_metadata) }),
            icon_url: icon?.url ?? randomBlob()?.url ?? null,
            plan: BASE_PLAN_SLUG,
            ...baseLimitsToColumns(),
            rerun_budget_micros: 0,
            price_arm: current?.price_arm ?? null,
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

    await grantRerunTopup(workspaceId, SIGNUP_BUDGET_MICROS)

    const { error: switchError } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: workspaceId }).eq('id', userId)
    if (switchError) return { ok: false, error: switchError.message }

    return { ok: true, workspaceId }
}

export async function enterSandboxAction(): Promise<ActionResult<{ workspaceId: number }>> {
    const userId = await requireUserId()

    if (!(await isExpertAccount(userId))) return failure('sandboxExpertOnly')
    if (await hasPendingCreatorTerms(userId)) return failure('acceptCreatorTermsFirst')

    return enterSandbox(userId)
}

export async function ensureSandboxSpaceAction(): Promise<ActionResult | { ok: false; error: string; locked: true }> {
    const workspaceId = await requireSandboxWorkspaceId()
    return (await ensureSandboxSpace(workspaceId)) ?? { ok: true }
}
