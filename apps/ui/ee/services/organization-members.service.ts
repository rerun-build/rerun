import 'server-only'
import type { Database } from '@/app/api/database.types'
import type { BoxScope, WorkspaceRole } from '@/app/api/_auth/ownership'
import { changeMemberRole, INVITE_TTL_MS, inviteMember, listMembersAndInvites, removeMember, revokeInvitation, type InviteResult, type InviteEntry, type MemberEntry } from '@/app/api/_services/members.service'
import { requireOrganizationWorkspace, type OrganizationContext } from '@/ee/services/organization-context.service'
import { toBoxScope } from '@/app/api/_auth/box-scope'
import { workspaceBrand } from '@/lib/brand/workspace'
import { brandAppUrl } from '@/lib/brand/urls'
import { AppError, type ActionFailure } from '@/lib/i18n/action-error'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// The people of a client's workspace, managed by the organization that runs it.

type Change = { ok: true } | ActionFailure

export async function listOrganizationWorkspaceMembers(ctx: OrganizationContext, workspaceId: number): Promise<{ members: MemberEntry[]; invites: InviteEntry[] }> {
    await requireOrganizationWorkspace(ctx, workspaceId)
    return listMembersAndInvites(ctx.supabase, workspaceId)
}

// Invited in the brand's name: the client never reads who, in the team, sent it.
export async function inviteOrganizationWorkspaceMember(ctx: OrganizationContext, workspaceId: number, email: string, role: WorkspaceRole, boxScope: BoxScope): Promise<InviteResult> {
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    return inviteMember({ supabase: ctx.supabase, workspace, invitedBy: { userId: ctx.userId, email: null } }, email, boxScope, role)
}

export async function revokeOrganizationWorkspaceInvitation(ctx: OrganizationContext, workspaceId: number, invitationId: string): Promise<Change> {
    await requireOrganizationWorkspace(ctx, workspaceId)
    return revokeInvitation(ctx.supabase, workspaceId, invitationId)
}

const INVITATION_COLUMNS = ['id', 'email', 'token', 'role', 'box_scope'] as const

async function requirePendingInvitation({ supabase }: OrganizationContext, workspaceId: number, invitationId: string) {
    const { data, error } = await selectMaybeSingle(supabase, 'workspace_invitations', INVITATION_COLUMNS, { id: invitationId, workspace_id: workspaceId, status: 'pending' })
    if (error) throw new Error(error.message)
    if (!data) throw new AppError('invitationNotFound')
    return data
}

// The same invitation, its link and its role, for seven more days.
export async function resendOrganizationWorkspaceInvitation(ctx: OrganizationContext, workspaceId: number, invitationId: string): Promise<InviteResult> {
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    const invitation = await requirePendingInvitation(ctx, workspaceId, invitationId)
    const { error } = await ctx.supabase
        .from('workspace_invitations')
        .update<Database['public']['Tables']['workspace_invitations']['Update']>({ expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString() })
        .eq('id', invitationId)
        .eq('status', 'pending')
    if (error) throw new Error(error.message)
    return inviteMember({ supabase: ctx.supabase, workspace, invitedBy: { userId: ctx.userId, email: null } }, invitation.email, toBoxScope(invitation.box_scope), invitation.role)
}

const invitationUrl = async (workspaceId: number, token: string) => `${brandAppUrl(await workspaceBrand(workspaceId))}/invite/${token}`

// What its email carries, for the team to pass on another way. Only the person invited can use it.
export async function readOrganizationWorkspaceInvitationUrl(ctx: OrganizationContext, workspaceId: number, invitationId: string): Promise<string> {
    await requireOrganizationWorkspace(ctx, workspaceId)
    return invitationUrl(workspaceId, (await requirePendingInvitation(ctx, workspaceId, invitationId)).token)
}

export async function pendingInvitationUrl({ supabase }: OrganizationContext, workspaceId: number, email: string): Promise<string | null> {
    const { data, error } = await selectMaybeSingle(supabase, 'workspace_invitations', ['token'] as const, { workspace_id: workspaceId, email: email.toLowerCase(), status: 'pending' })
    if (error) throw new Error(error.message)
    return data && invitationUrl(workspaceId, data.token)
}

// A client's person has no other workspace most of the time: one of their own is opened for them, so
// that their account outlives it.
export async function removeOrganizationWorkspaceMember(ctx: OrganizationContext, workspaceId: number, userId: string): Promise<Change> {
    await requireOrganizationWorkspace(ctx, workspaceId)
    return removeMember(ctx.supabase, workspaceId, userId, { openOne: true })
}

export async function setOrganizationWorkspaceMemberRole(ctx: OrganizationContext, workspaceId: number, userId: string, role: WorkspaceRole): Promise<Change> {
    await requireOrganizationWorkspace(ctx, workspaceId)
    return changeMemberRole(ctx.supabase, workspaceId, userId, role)
}
