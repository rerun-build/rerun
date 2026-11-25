import { isWhiteLabel, ORGANIZATION_AUTHOR_ID, type MemberProfile } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'

import { toBoxScope, type BoxScope, type WorkspaceContext, type WorkspaceRole } from '@/app/api/_auth/ownership'
import { countWorkspaceMembers, organizationStaffAmong, selectWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import type { Database } from '@/app/api/database.types'
import { moveToOtherWorkspace } from '@/app/api/_services/default-workspace.service'
import { displayNameOf, readProfile } from '@/app/api/_services/me.service'
import { revokeMemberComputers } from '@/app/api/_services/remote-computers.service'
import { BANNER_WARM_BACKGROUND_MS, EMAIL_DELIVERY, emailBoardBanner, sendWorkspaceInviteEmail } from '@rerun/cloud/email'
import { failure, type ActionFailure, type ErrorCode } from '@/lib/i18n/action-error'
import { brandAppUrl } from '@/lib/brand/urls'
import { workspaceBrand } from '@/lib/brand/workspace'
import { workspaceLocale } from '@/lib/i18n/recipient-locale'
import { randomUuid } from '@/lib/random-uuid'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { emailTranslator } from '@rerun/emails/i18n'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function isEmailAddress(value: string): boolean {
    return EMAIL_RE.test(value)
}

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

// Who did something in a workspace, as its members read it: the people of the organization that runs
// it answer to its brand, never to their own name or address.
export async function resolveWorkspaceIdentities(supabase: SupabaseClient<Database>, workspaceId: number, userIds: string[]): Promise<Map<string, MemberIdentity & { id: string }>> {
    const staff = await organizationStaffAmong(supabase, workspaceId, userIds)
    const people = await resolveMemberIdentities(supabase, userIds.filter(id => !staff.has(id)))
    const identities = new Map([...people].map(([id, identity]) => [id, { id, ...identity }]))
    if (staff.size === 0) return identities
    const brand = await workspaceBrand(workspaceId)
    for (const id of staff) identities.set(id, { id: ORGANIZATION_AUTHOR_ID, email: null, name: brand.name, avatarUrl: brand.iconUrl })
    return identities
}

// Who signs a message in a conversation: every member of the workspace, with the name and photo of
// their auth record, and the brand of the organization that runs it. Its team signs with the brand's
// id; one of them also finds their own, which their app puts on a message until it is read back.
export async function listMemberProfiles({ workspace, supabase, userId, organizationStaff }: WorkspaceContext): Promise<MemberProfile[]> {
    const [{ data: memberRows }, brand] = await Promise.all([selectWorkspaceMembers(supabase, ['user_id', 'role'] as const, { workspace_id: workspace.id }), workspaceBrand(workspace.id)])
    const rows = memberRows ?? []
    const identities = await resolveMemberIdentities(supabase, rows.map(m => m.user_id))
    const signers = [...(isWhiteLabel(brand) ? [ORGANIZATION_AUTHOR_ID] : []), ...(organizationStaff ? [userId] : [])]
    return [
        ...rows.map(({ user_id: id, role }) => ({ id, name: identities.get(id)?.name ?? null, avatarUrl: identities.get(id)?.avatarUrl ?? null, role })),
        ...signers.map(id => ({ id, name: brand.name, avatarUrl: brand.iconUrl })),
    ]
}

export const LAST_ADMIN = 'The workspace needs at least one admin'

// Whether taking `userId` out of the admins (removal, demotion, departure) would leave the
// workspace with none. A member is never the last admin.
export async function isLastAdmin(supabase: SupabaseClient<Database>, workspaceId: number, userId: string): Promise<boolean> {
    const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['role'] as const, { workspace_id: workspaceId, user_id: userId, organization_staff: false })
    if (target?.role !== 'admin') return false
    const { data: admins } = await countWorkspaceMembers(supabase, { workspace_id: workspaceId, role: 'admin' })
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
    const { data: admins } = await countWorkspaceMembers(supabase, { workspace_id: workspaceId, role: 'admin' })
    if ((admins ?? 0) > 0) return { error: null }
    const { error: restoreError } = await setMemberRole(supabase, workspaceId, userId, 'admin')
    return { error: restoreError ?? LAST_ADMIN }
}

export type MemberEntry = { userId: string; email: string | null; name: string | null; role: WorkspaceRole; boxScope: BoxScope }
export type InviteEntry = { id: string; email: string; status: string; createdAt: string; boxScope: BoxScope; role: WorkspaceRole }

export async function listMembersAndInvites(supabase: SupabaseClient<Database>, workspaceId: number): Promise<{ members: MemberEntry[]; invites: InviteEntry[] }> {
    const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
        selectWorkspaceMembers(supabase, ['user_id', 'role', 'box_scope'] as const, { workspace_id: workspaceId }),
        selectAll(supabase, 'workspace_invitations', ['id', 'email', 'status', 'created_at', 'box_scope', 'role'] as const, { workspace_id: workspaceId, status: 'pending' }, { column: 'created_at', ascending: true }),
    ])
    const rows = memberRows ?? []
    const identities = await resolveMemberIdentities(supabase, rows.map(m => m.user_id))
    return {
        members: rows.map(m => ({ userId: m.user_id, email: identities.get(m.user_id)?.email ?? null, name: identities.get(m.user_id)?.name ?? null, role: m.role, boxScope: toBoxScope(m.box_scope) })),
        invites: (inviteRows ?? []).map(i => ({ id: i.id, email: i.email, status: i.status, createdAt: i.created_at, boxScope: toBoxScope(i.box_scope), role: i.role })),
    }
}

type MemberChange = { ok: true } | ActionFailure

export async function revokeInvitation(supabase: SupabaseClient<Database>, workspaceId: number, invitationId: string): Promise<MemberChange> {
    const { data: invite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['workspace_id'] as const, { id: invitationId })
    if (!invite || invite.workspace_id !== workspaceId) return failure('invitationNotFound')

    const { error } = await supabase.from('workspace_invitations').update<Database['public']['Tables']['workspace_invitations']['Update']>({ status: 'revoked' }).eq('id', invitationId)
    return error ? { ok: false, error: error.message } : { ok: true }
}

// `openOne`: someone whose only workspace is this one gets a new one of their own, rather than being
// kept in it.
export async function removeMember(supabase: SupabaseClient<Database>, workspaceId: number, targetUserId: string, { openOne }: { openOne: boolean }): Promise<MemberChange> {
    const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { user_id: targetUserId, workspace_id: workspaceId, organization_staff: false })
    if (!target) return failure('userNotMember')
    if (await isLastAdmin(supabase, workspaceId, targetUserId)) return failure('needsAdmin')
    if (!(await moveToOtherWorkspace(supabase, targetUserId, workspaceId, { openOne }))) return failure('onlyWorkspaceOfUser')

    const { error } = await supabase.from('workspace_members').delete().eq('user_id', targetUserId).eq('workspace_id', workspaceId)
    if (error) return { ok: false, error: error.message }
    await revokeMemberComputers(workspaceId, targetUserId).catch(err => console.warn('[members] computers of a removed member left linked until they reconnect', err))
    return { ok: true }
}

export async function changeMemberRole(supabase: SupabaseClient<Database>, workspaceId: number, targetUserId: string, role: WorkspaceRole): Promise<MemberChange> {
    const { data: target } = await selectMaybeSingle(supabase, 'workspace_members', ['role'] as const, { user_id: targetUserId, workspace_id: workspaceId, organization_staff: false })
    if (!target) return failure('userNotMember')
    if (target.role === role) return { ok: true }
    if (role === 'member' && (await isLastAdmin(supabase, workspaceId, targetUserId))) return failure('needsAdmin')

    const { error } = role === 'member' ? await demoteKeepingAnAdmin(supabase, workspaceId, targetUserId) : await setMemberRole(supabase, workspaceId, targetUserId, role)
    if (!error) return { ok: true }
    return error === LAST_ADMIN ? failure('needsAdmin') : { ok: false, error }
}

// Who invites, into which workspace: the dialog's admin, or the Chief of Staff speaking for one.
export type InviteScope = { supabase: SupabaseClient<Database>; workspace: { id: number; name: string | null; max_seats: number | null }; invitedBy: { userId: string; email: string | null } }

// `inviteUrl` comes back where no email leaves, for the person inviting to pass on.
export type InviteResult = { ok: true; inviteUrl?: string } | { ok: false; code: ErrorCode } | { ok: false; error: string }

// One invitation, or the pending one for that address with its new scope. `boxScope` and the role are
// copied onto the membership when the invitation is accepted. Without a role named, a new invitation
// is a member's and a pending one keeps its own.
export async function inviteMember({ supabase, workspace, invitedBy }: InviteScope, rawEmail: string, rawBoxScope: BoxScope = 'all', role?: WorkspaceRole): Promise<InviteResult> {
    const boxScope = toBoxScope(rawBoxScope)
    const email = rawEmail.trim().toLowerCase()
    if (!isEmailAddress(email)) return { ok: false, code: 'invalidEmailShort' }

    const { data: memberRows } = await selectWorkspaceMembers(supabase, ['user_id'] as const, { workspace_id: workspace.id })
    const memberIds = (memberRows ?? []).map(m => m.user_id)
    const identities = await resolveMemberIdentities(supabase, memberIds)
    if ([...identities.values()].some(identity => identity.email === email)) return { ok: false, code: 'alreadyMember' }

    const { data: existingInvite } = await selectMaybeSingle(supabase, 'workspace_invitations', ['id', 'token', 'box_scope', 'role'] as const, { workspace_id: workspace.id, email, status: 'pending' })

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
            role: role ?? 'member',
            expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
        })
        if (error) return { ok: false, error: error.message }
    } else {
        const changed: Database['public']['Tables']['workspace_invitations']['Update'] = {
            ...(toBoxScope(existingInvite.box_scope) !== boxScope ? { box_scope: boxScope } : {}),
            ...(role && existingInvite.role !== role ? { role } : {}),
        }
        if (Object.keys(changed).length > 0) {
            const { error } = await supabase.from('workspace_invitations').update<Database['public']['Tables']['workspace_invitations']['Update']>(changed).eq('id', existingInvite.id)
            if (error) return { ok: false, error: error.message }
        }
    }

    // After the response: the invitation is saved, and the board the email opens on can take a cold
    // capture without holding the caller.
    const brand = await workspaceBrand(workspace.id)
    const inviteUrl = `${brandAppUrl(brand)}/invite/${token}`
    after(async () => {
        const serviceRole = createServiceRoleClient()
        const boardUrl = await emailBoardBanner(serviceRole, workspace.id, 'working', BANNER_WARM_BACKGROUND_MS, brand)
        const locale = await workspaceLocale(serviceRole, workspace.id)
        const workspaceName = workspace.name ?? emailTranslator(locale, brand.name)('common.yourWorkspace')
        await sendWorkspaceInviteEmail({ to: email, workspaceName, inviteUrl, invitedByEmail: invitedBy.email ?? undefined, boardUrl, locale, brand })
    })

    return EMAIL_DELIVERY ? { ok: true } : { ok: true, inviteUrl }
}

