import 'server-only'
import type { BoxScope, WorkspaceRole } from '@/app/api/_auth/ownership'
import { changeMemberRole, inviteMember, listMembersAndInvites, removeMember, revokeInvitation, type InviteResult, type InviteEntry, type MemberEntry } from '@/app/api/_services/members.service'
import { requireOrganizationWorkspace, type OrganizationContext } from '@/ee/services/organization-context.service'
import type { ActionFailure } from '@/lib/i18n/action-error'

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
