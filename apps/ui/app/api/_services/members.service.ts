import type { MemberProfile } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'

import { toBoxScope, type BoxScope, type WorkspaceContext, type WorkspaceRole } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { displayNameOf, readProfile } from '@/app/api/_services/me.service'
import { BANNER_WARM_BACKGROUND_MS, EMAIL_DELIVERY, emailBoardBanner, sendWorkspaceInviteEmail } from '@rerun/cloud/email'
import type { ErrorCode } from '@/lib/i18n/action-error'
import { workspaceLocale } from '@/lib/i18n/recipient-locale'
import { randomUuid } from '@/lib/random-uuid'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { emailTranslator } from '@rerun/emails/i18n'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rerun.build'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

type MemberIdentity = { email: string | null; name: string | null; avatarUrl: string | null }

export async function resolveMemberIdentities(supabase: SupabaseClient<Database>, userIds: string[]): Promise<Map<string, MemberIdentity>> {
    const identities = new Map<string, MemberIdentity>()
    await Promise.all(
        userIds.map(async id => {
            const { data } = await supabase.auth.admin.getUserById(id)
            if (!data.user) return
            identities.set(id, { email: accountLabel(data.user.email?.toLowerCase()), name: displayNameOf(data.user), avatarUrl: readProfile(data.user).avatarUrl })
        }),
    )
    return identities
}

// Who signs a message in a conversation: every member of the workspace, with the name and photo of
// their auth record.
export async function listMemberProfiles({ workspace, supabase }: WorkspaceContext): Promise<MemberProfile[]> {
    const { data: memberRows } = await selectAll(supabase, 'workspace_members', ['user_id', 'role'] as const, { workspace_id: workspace.id }, { column: 'created_at', ascending: true })
    const rows = memberRows ?? []
    const identities = await resolveMemberIdentities(supabase, rows.map(m => m.user_id))
    return rows.map(({ user_id: id, role }) => ({ id, name: identities.get(id)?.name ?? null, avatarUrl: identities.get(id)?.avatarUrl ?? null, role }))
}

export const LAST_ADMIN = 'The workspace needs at least one admin'

// Whether taking `userId` out of the admins (removal, demotion, departure) would leave the
// workspace with none. A member is never the last admin.
export async function isLastAdmin(supabase: SupabaseClient<Database>, workspaceId: number, userId: string): Promise<boolean> {
    const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['role'] as const, { workspace_id: workspaceId, user_id: userId })
    if (target?.role !== 'admin') return false
    const { data: admins } = await selectCount(supabase, 'workspace_members', { workspace_id: workspaceId, role: 'admin' })
    return (admins ?? 0) <= 1
}

export async function setMemberRole(supabase: SupabaseClient<Database>, workspaceId: number, userId: string, role: WorkspaceRole): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('workspace_members')
        .update<Database['public']['Tables']['workspace_members']['Update']>({ role })
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
    return { error: error?.message ?? null }
}

// Two admins stepping down at the same time both pass `isLastAdmin`, so the admins are counted
// again once the demotion is written: the one who finds none left takes the role back.
export async function demoteKeepingAnAdmin(supabase: SupabaseClient<Database>, workspaceId: number, userId: string): Promise<{ error: string | null }> {
    const { error } = await setMemberRole(supabase, workspaceId, userId, 'member')
    if (error) return { error }
    const { data: admins } = await selectCount(supabase, 'workspace_members', { workspace_id: workspaceId, role: 'admin' })
    if ((admins ?? 0) > 0) return { error: null }
    const { error: restoreError } = await setMemberRole(supabase, workspaceId, userId, 'admin')
    return { error: restoreError ?? LAST_ADMIN }
}

// Who invites, into which workspace: the dialog's admin, or the Chief of Staff speaking for one.
export type InviteScope = { supabase: SupabaseClient<Database>; workspace: { id: number; name: string | null; max_seats: number | null }; invitedBy: { userId: string; email: string | null } }

// `inviteUrl` comes back where no email leaves, for the person inviting to pass on.
export type InviteResult = { ok: true; inviteUrl?: string } | { ok: false; code: ErrorCode } | { ok: false; error: string }

// One invitation, or the pending one for that address with its new scope. `boxScope` is copied onto
// the membership when the invitation is accepted.
export async function inviteMember({ supabase, workspace, invitedBy }: InviteScope, rawEmail: string, rawBoxScope: BoxScope = 'all'): Promise<InviteResult> {
    const boxScope = toBoxScope(rawBoxScope)
    const email = rawEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return { ok: false, code: 'invalidEmailShort' }

    const { data: memberRows } = await selectAll(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspace.id })
    const memberIds = (memberRows ?? []).map(m => m.user_id)
    const identities = await resolveMemberIdentities(supabase, memberIds)
    if ([...identities.values()].some(identity => identity.email === email)) return { ok: false, code: 'alreadyMember' }

    const { data: existingInvite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['id', 'token', 'box_scope'] as const, { workspace_id: workspace.id, email, status: 'pending' })

    let token = existingInvite?.token
    if (!existingInvite) {
        const { data: pendingCount } = await selectCount(supabase, 'workspace_invitations', { workspace_id: workspace.id, status: 'pending' })
        const total = memberIds.length + (pendingCount ?? 0)
        if (workspace.max_seats != null && total >= workspace.max_seats) return { ok: false, code: 'seatLimit' }

        token = randomUuid()
        const { error } = await supabase.from('workspace_invitations').insert<Database['public']['Tables']['workspace_invitations']['Insert']>({
            workspace_id: workspace.id,
            email,
            token,
            invited_by: invitedBy.userId,
            status: 'pending',
            box_scope: boxScope,
            expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
        })
        if (error) return { ok: false, error: error.message }
    } else if (toBoxScope(existingInvite.box_scope) !== boxScope) {
        const { error } = await supabase.from('workspace_invitations').update<Database['public']['Tables']['workspace_invitations']['Update']>({ box_scope: boxScope }).eq('id', existingInvite.id)
        if (error) return { ok: false, error: error.message }
    }

    // After the response: the invitation is saved, and the board the email opens on can take a cold
    // capture without holding the caller.
    const inviteUrl = `${APP_URL}/invite/${token}`
    after(async () => {
        const serviceRole = createServiceRoleClient()
        const boardUrl = await emailBoardBanner(serviceRole, workspace.id, 'working', BANNER_WARM_BACKGROUND_MS)
        const locale = await workspaceLocale(serviceRole, workspace.id)
        const workspaceName = workspace.name ?? emailTranslator(locale)('common.yourWorkspace')
        await sendWorkspaceInviteEmail({ to: email, workspaceName, inviteUrl, invitedByEmail: invitedBy.email ?? undefined, boardUrl, locale })
    })

    return EMAIL_DELIVERY ? { ok: true } : { ok: true, inviteUrl }
}

