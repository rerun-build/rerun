'use server'

import { requireAdminContext, requireWorkspaceContext, toBoxScope, type BoxScope, type WorkspaceRole } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { INVITATION_COLUMNS, takeInvitation } from '@/app/api/_services/invitation.service'
import { changeMemberRole, inviteMember, listMemberProfiles, listMembersAndInvites, removeMember, revokeInvitation, type InviteEntry, type MemberEntry } from '@/app/api/_services/members.service'
import { ownsEmail } from '@/lib/auth/account-emails'
import { requestHostScope } from '@/lib/brand/host-scope'
import { workspaceAppUrl } from '@/lib/brand/workspace'
import { opensOnHost } from '@/lib/workspace/host-workspace'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getAuthUser } from '@/supabase/session/getServerSession'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { MemberProfile } from '@rerun/contracts'

import { failure, failureOf, type ErrorCode } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'

export type WorkspaceMember = MemberEntry
export type WorkspaceInviteRow = Omit<InviteEntry, 'role'>

const MEMBERS_ADMIN_ONLY = 'adminOnlyMembers' satisfies ErrorCode

// Who signs a message in a conversation. Names and photos live in the auth records, which
// no member can read from the browser.
export async function listMemberProfilesAction(): Promise<MemberProfile[]> {
    return listMemberProfiles(await requireWorkspaceContext())
}

export async function listWorkspaceMembersAction(): Promise<ActionResult<{ members: WorkspaceMember[]; invites: WorkspaceInviteRow[]; currentUserId: string; currentRole: WorkspaceRole }>> {
    try {
        const { userId, role, workspace, supabase } = await requireWorkspaceContext()

        const { members, invites } = await listMembersAndInvites(supabase, workspace.id)
        return { ok: true, members, invites, currentUserId: userId, currentRole: role }
    } catch (err) {
        return failureOf(err, 'loadMembersFailed')
    }
}

export async function inviteToWorkspaceAction(rawEmail: string, rawBoxScope: BoxScope = 'all'): Promise<ActionResult<{ inviteUrl?: string }>> {
    try {
        const { userId, userEmail, organizationStaff, workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)
        const result = await inviteMember({ supabase, workspace, invitedBy: { userId, email: organizationStaff ? null : userEmail } }, rawEmail, rawBoxScope)
        if (result.ok) return result
        return 'code' in result ? failure(result.code) : result
    } catch (err) {
        return failureOf(err, 'sendInvitationFailed')
    }
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
    try {
        const { workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)
        return await revokeInvitation(supabase, workspace.id, invitationId)
    } catch (err) {
        return failureOf(err, 'revokeInvitationFailed')
    }
}

export async function removeMemberAction(targetUserId: string): Promise<ActionResult> {
    try {
        const { userId, workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)
        if (targetUserId === userId) return failure('cannotRemoveSelf')
        return await removeMember(supabase, workspace.id, targetUserId, { openOne: false })
    } catch (err) {
        return failureOf(err, 'removeMemberFailed')
    }
}

export async function setMemberRoleAction(targetUserId: string, role: WorkspaceRole): Promise<ActionResult> {
    try {
        const { workspace, supabase } = await requireAdminContext(MEMBERS_ADMIN_ONLY)
        return await changeMemberRole(supabase, workspace.id, targetUserId, role)
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

        const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['role', 'box_scope'] as const, { user_id: targetUserId, workspace_id: workspace.id, organization_staff: false })
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
    // It is joined at the address of the organization that runs the workspace.
    | { status: 'elsewhere'; url: string }
    | { status: 'not_found' }
    | { status: 'unavailable' }
    | { status: 'expired' }

export async function loadInvitationAction(token: string): Promise<InvitationView> {
    const supabase = createServiceRoleClient()
    const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['email', 'status', 'expires_at', 'workspace_id'] as const, { token })
    if (!invite) return { status: 'not_found' }

    const [scope, { data: workspace }] = await Promise.all([requestHostScope(), selectMaybeSingle(supabase, 'workspaces', ['name', 'organization_id'] as const, { id: invite.workspace_id })])
    if (!opensOnHost(scope, workspace?.organization_id ?? null)) {
        if (scope?.organizationId) return { status: 'not_found' }
        return { status: 'elsewhere', url: `${await workspaceAppUrl(invite.workspace_id)}/invite/${encodeURIComponent(token)}` }
    }

    if (invite.status !== 'pending') return { status: 'unavailable' }
    if (new Date(invite.expires_at).getTime() < Date.now()) return { status: 'expired' }
    return { status: 'ok', email: invite.email, workspaceName: workspace?.name ?? 'a workspace' }
}

// The page is rendered again after the one that accepted (a refresh racing the sign-in navigation,
// a reload): whoever it was meant for, already a member, is let in rather than told it was used.
export async function joinedWorkspaceForInvitationAction(token: string): Promise<number | null> {
    const account = await getAuthUser()
    if (!account?.email) return null

    const supabase = createServiceRoleClient()
    const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['workspace_id', 'email', 'status'] as const, { token })
    if (!invite || invite.status !== 'accepted') return null
    if (!ownsEmail(account, invite.email)) return null

    const { data: membership } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { user_id: account.id, workspace_id: invite.workspace_id })
    return membership ? invite.workspace_id : null
}

// Whoever is signed in, with or without a workspace open: the one they join may be their first on this
// host.
export async function acceptInvitationAction(token: string): Promise<ActionResult<{ workspaceId: number }>> {
    const account = await getAuthUser()
    if (!account?.email) return failure('signInToAcceptInvitation')

    const supabase = createServiceRoleClient()
    const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', INVITATION_COLUMNS, { token })
    if (!invite) return failure('invitationNotFound')
    const scope = await requestHostScope()
    if (scope) {
        const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['organization_id'] as const, { id: invite.workspace_id })
        if (!opensOnHost(scope, workspace?.organization_id ?? null)) return failure('invitationNotFound')
    }
    if (invite.status !== 'pending') return failure('invitationInvalid')
    if (new Date(invite.expires_at).getTime() < Date.now()) return failure('invitationExpired')
    if (!ownsEmail(account, invite.email)) {
        return failure('invitationForEmail', { email: invite.email })
    }

    const taken = await takeInvitation(supabase, account.id, invite)
    if (!taken.ok) {
        if (taken.reason === 'failed') return { ok: false, error: taken.message }
        return failure(taken.reason === 'noSeat' ? 'noSeatLeft' : 'invitationInvalid')
    }

    await supabase.from('users').update<Database['public']['Tables']['users']['Update']>({ workspace_id: invite.workspace_id }).eq('id', account.id)

    return { ok: true, workspaceId: invite.workspace_id }
}
