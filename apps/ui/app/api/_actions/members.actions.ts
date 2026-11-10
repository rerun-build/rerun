'use server'

import { after } from 'next/server'
import { requireAdminContext, requireWorkspaceContext, toBoxScope, type BoxScope, type WorkspaceRole } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { demoteKeepingAnAdmin, isLastAdmin, LAST_ADMIN, listMemberProfiles, resolveMemberIdentities, setMemberRole } from '@/app/api/_services/members.service'
import { BANNER_WARM_BACKGROUND_MS, EMAIL_DELIVERY, emailBoardBanner, sendWorkspaceInviteEmail } from '@rerun/cloud/email'
import { workspaceLocale } from '@/lib/i18n/recipient-locale'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { emailTranslator } from '@rerun/emails/i18n'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { MemberProfile } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

import { failure, failureOf, type ErrorCode } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'
import { randomUuid } from '@/lib/random-uuid'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rerun.build'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MEMBERS_ADMIN_ONLY = 'adminOnlyMembers' satisfies ErrorCode

type ServiceClient = SupabaseClient<Database>

async function resolveMemberEmails(supabase: ServiceClient, userIds: string[]): Promise<Map<string, string>> {
    const identities = await resolveMemberIdentities(supabase, userIds)
    const emails = new Map<string, string>()
    for (const [id, identity] of identities) if (identity.email) emails.set(id, identity.email)
    return emails
}

export type WorkspaceMember = { userId: string; email: string | null; role: WorkspaceRole; boxScope: BoxScope }

// Who signs a message in a conversation. Names and photos live in the auth records, which
// no member can read from the browser.
export async function listMemberProfilesAction(): Promise<MemberProfile[]> {
    return listMemberProfiles(await requireWorkspaceContext())
}
export type WorkspaceInviteRow = { id: string; email: string; status: string; createdAt: string; boxScope: BoxScope }

export async function listWorkspaceMembersAction(): Promise<ActionResult<{ members: WorkspaceMember[]; invites: WorkspaceInviteRow[]; currentUserId: string; currentRole: WorkspaceRole }>> {
    try {
        const { userId, role, workspace, supabase } = await requireWorkspaceContext()

        const { data: memberRows } = await selectAll(supabase, 'workspace_members', ['user_id', 'role', 'box_scope'] as const, { workspace_id: workspace.id }, { column: 'created_at', ascending: true })
        const rows = memberRows ?? []
        const emails = await resolveMemberEmails(supabase, rows.map(m => m.user_id))
        const members: WorkspaceMember[] = rows.map(m => ({ userId: m.user_id, email: emails.get(m.user_id) ?? null, role: m.role, boxScope: toBoxScope(m.box_scope) }))

        const { data: inviteRows } = await selectAll(supabase, 'workspace_invitations', ['id', 'email', 'status', 'created_at', 'box_scope'] as const, { workspace_id: workspace.id, status: 'pending' }, { column: 'created_at', ascending: true })
        const invites: WorkspaceInviteRow[] = (inviteRows ?? []).map(i => ({ id: i.id, email: i.email, status: i.status, createdAt: i.created_at, boxScope: toBoxScope(i.box_scope) }))

        return { ok: true, members, invites, currentUserId: userId, currentRole: role }
    } catch (err) {
        return failureOf(err, 'loadMembersFailed')
    }
}

// `inviteUrl` comes back where no email leaves, for the person inviting to pass on. `boxScope` is
// copied onto the membership when the invitation is accepted.
export async function inviteToWorkspaceAction(rawEmail: string, rawBoxScope: BoxScope = 'all'): Promise<ActionResult<{ inviteUrl?: string }>> {
    try {
        const { userId, userEmail, workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)
        const boxScope = toBoxScope(rawBoxScope)

        const email = rawEmail.trim().toLowerCase()
        if (!EMAIL_RE.test(email)) return failure('invalidEmailShort')

        const { data: memberRows } = await selectAll(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspace.id })
        const memberIds = (memberRows ?? []).map(m => m.user_id)
        const memberEmails = await resolveMemberEmails(supabase, memberIds)
        if ([...memberEmails.values()].includes(email)) return failure('alreadyMember')

        const { data: existingInvite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['id', 'token', 'box_scope'] as const, { workspace_id: workspace.id, email, status: 'pending' })

        let token = existingInvite?.token
        if (!existingInvite) {
            const { data: pendingCount } = await selectCount(supabase, 'workspace_invitations', { workspace_id: workspace.id, status: 'pending' })
            const total = memberIds.length + (pendingCount ?? 0)
            if (workspace.max_seats != null && total >= workspace.max_seats) {
                return failure('seatLimit')
            }

            token = randomUuid()
            const { error } = await supabase.from('workspace_invitations').insert<Database['public']['Tables']['workspace_invitations']['Insert']>({
                workspace_id: workspace.id,
                email,
                token,
                invited_by: userId,
                status: 'pending',
                box_scope: boxScope,
                expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
            })
            if (error) return { ok: false, error: error.message }
        } else if (toBoxScope(existingInvite.box_scope) !== boxScope) {
            const { error } = await supabase.from('workspace_invitations').update<Database['public']['Tables']['workspace_invitations']['Update']>({ box_scope: boxScope }).eq('id', existingInvite.id)
            if (error) return { ok: false, error: error.message }
        }

        // After the response: the invitation is saved, and the board the email opens on can take a
        // cold capture without holding the dialog.
        const inviteUrl = `${APP_URL}/invite/${token}`
        after(async () => {
            const serviceRole = createServiceRoleClient()
            const boardUrl = await emailBoardBanner(serviceRole, workspace.id, 'working', BANNER_WARM_BACKGROUND_MS)
            const locale = await workspaceLocale(serviceRole, workspace.id)
            const workspaceName = workspace.name ?? emailTranslator(locale)('common.yourWorkspace')
            await sendWorkspaceInviteEmail({ to: email, workspaceName, inviteUrl, invitedByEmail: userEmail ?? undefined, boardUrl, locale })
        })

        return EMAIL_DELIVERY ? { ok: true } : { ok: true, inviteUrl }
    } catch (err) {
        return failureOf(err, 'sendInvitationFailed')
    }
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
    try {
        const { workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)

        const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['workspace_id'] as const, { id: invitationId })
        if (!invite || invite.workspace_id !== workspace.id) return failure('invitationNotFound')

        const { error } = await supabase.from('workspace_invitations').update<Database['public']['Tables']['workspace_invitations']['Update']>({ status: 'revoked' }).eq('id', invitationId)
        if (error) return { ok: false, error: error.message }
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'revokeInvitationFailed')
    }
}

export async function removeMemberAction(targetUserId: string): Promise<ActionResult> {
    try {
        const { userId, workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)
        if (targetUserId === userId) return failure('cannotRemoveSelf')

        const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { user_id: targetUserId, workspace_id: workspace.id })
        if (!target) return failure('userNotMember')
        if (await isLastAdmin(supabase, workspace.id, targetUserId)) return failure('needsAdmin')

        const { data: targetUser } = await selectMaybeSingle(supabase, 'users', ['workspace_id'] as const, { id: targetUserId })
        if (targetUser?.workspace_id === workspace.id) {
            const { data: memberships } = await selectAll(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: targetUserId })
            const fallback = (memberships ?? []).find(m => m.workspace_id !== workspace.id)
            if (!fallback) return failure('onlyWorkspaceOfUser')
            const { error: switchError } = await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: fallback.workspace_id }).eq('id', targetUserId)
            if (switchError) return { ok: false, error: switchError.message }
        }

        const { error } = await supabase.from('workspace_members').delete().eq('user_id', targetUserId).eq('workspace_id', workspace.id)
        if (error) return { ok: false, error: error.message }
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'removeMemberFailed')
    }
}

export async function setMemberRoleAction(targetUserId: string, role: WorkspaceRole): Promise<ActionResult> {
    try {
        const { workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)

        const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['role'] as const, { user_id: targetUserId, workspace_id: workspace.id })
        if (!target) return failure('userNotMember')
        if (target.role === role) return { ok: true }
        if (role === 'member' && (await isLastAdmin(supabase, workspace.id, targetUserId))) return failure('needsAdmin')

        const { error } = role === 'member' ? await demoteKeepingAnAdmin(supabase, workspace.id, targetUserId) : await setMemberRole(supabase, workspace.id, targetUserId, role)
        if (error) return error === LAST_ADMIN ? failure('needsAdmin') : { ok: false, error }
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'changeRoleFailed')
    }
}

// Whether a member uses every Box open to the workspace or only the ones named to them. An admin
// reaches every Box whatever the scope, so theirs is not changed.
export async function setMemberBoxScopeAction(targetUserId: string, boxScope: BoxScope): Promise<ActionResult> {
    try {
        const { workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)
        if (boxScope !== 'all' && boxScope !== 'assigned') return failure('unknownScope')

        const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['role', 'box_scope'] as const, { user_id: targetUserId, workspace_id: workspace.id })
        if (!target) return failure('userNotMember')
        if (target.role === 'admin') return failure('adminsReachEveryBox')
        if (toBoxScope(target.box_scope) === boxScope) return { ok: true }

        const { error } = await supabase
            .from('workspace_members')
            .update<Database['public']['Tables']['workspace_members']['Update']>({ box_scope: boxScope })
            .eq('user_id', targetUserId)
            .eq('workspace_id', workspace.id)
        if (error) return { ok: false, error: error.message }
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'changeMemberBoxesFailed')
    }
}

export type InvitationView =
    | { status: 'ok'; email: string; workspaceName: string }
    | { status: 'not_found' }
    | { status: 'unavailable' }
    | { status: 'expired' }

export async function loadInvitationAction(token: string): Promise<InvitationView> {
    const supabase = createServiceRoleClient()
    const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['email', 'status', 'expires_at', 'workspace_id'] as const, { token })
    if (!invite) return { status: 'not_found' }
    if (invite.status !== 'pending') return { status: 'unavailable' }
    if (new Date(invite.expires_at).getTime() < Date.now()) return { status: 'expired' }

    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['name'] as const, { id: invite.workspace_id })
    return { status: 'ok', email: invite.email, workspaceName: workspace?.name ?? 'a workspace' }
}

// The page is rendered again after the one that accepted (a refresh racing the sign-in navigation,
// a reload): whoever it was meant for, already a member, is let in rather than told it was used.
export async function joinedWorkspaceForInvitationAction(token: string): Promise<number | null> {
    const { user, session } = await getServerSession()
    if (!user?.id || !session?.email) return null

    const supabase = createServiceRoleClient()
    const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['workspace_id', 'email', 'status'] as const, { token })
    if (!invite || invite.status !== 'accepted') return null
    if (invite.email.toLowerCase() !== session.email.toLowerCase()) return null

    const { data: membership } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { user_id: user.id, workspace_id: invite.workspace_id })
    return membership ? invite.workspace_id : null
}

export async function acceptInvitationAction(token: string): Promise<ActionResult<{ workspaceId: number }>> {
    const { user, session } = await getServerSession()
    if (!user?.id || !session?.email) return failure('signInToAcceptInvitation')

    const supabase = createServiceRoleClient()
    const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['id', 'workspace_id', 'email', 'status', 'expires_at', 'box_scope'] as const, { token })
    if (!invite) return failure('invitationNotFound')
    if (invite.status !== 'pending') return failure('invitationInvalid')
    if (new Date(invite.expires_at).getTime() < Date.now()) return failure('invitationExpired')
    if (invite.email.toLowerCase() !== session.email.toLowerCase()) {
        return failure('invitationForEmail', { email: invite.email })
    }

    // Claimed before the seats are counted: only one tab can move it off `pending`, so only one gets to count and insert.
    const { data: claimed } = await supabase
        .from('workspace_invitations')
        .update<Database['public']['Tables']['workspace_invitations']['Update']>({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
    if (!claimed) return failure('invitationInvalid')

    const releaseInvitation = () =>
        supabase.from('workspace_invitations').update<Database['public']['Tables']['workspace_invitations']['Update']>({ status: 'pending', accepted_at: null }).eq('id', invite.id).eq('status', 'accepted')

    const { data: existing } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { user_id: user.id, workspace_id: invite.workspace_id })
    if (!existing) {
        const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['max_seats'] as const, { id: invite.workspace_id })
        const { data: seatsTaken } = await selectCount(supabase, 'workspace_members', { workspace_id: invite.workspace_id })
        if (workspace?.max_seats != null && (seatsTaken ?? 0) >= workspace.max_seats) {
            await releaseInvitation()
            return failure('noSeatLeft')
        }

        const { error } = await supabase.from('workspace_members').insert<Database['public']['Tables']['workspace_members']['Insert']>({
            user_id: user.id,
            workspace_id: invite.workspace_id,
            role: 'member',
            box_scope: toBoxScope(invite.box_scope),
        })
        if (error) {
            await releaseInvitation()
            return { ok: false, error: error.message }
        }
    }

    await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: invite.workspace_id }).eq('id', user.id)

    return { ok: true, workspaceId: invite.workspace_id }
}
