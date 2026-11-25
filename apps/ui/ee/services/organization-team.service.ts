import 'server-only'
import type { User } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { INVITE_TTL_MS, isEmailAddress, resolveMemberIdentities } from '@/app/api/_services/members.service'
import { readOrganization, toOrganizationRole, type OrganizationContext, type OrganizationRole } from '@/ee/services/organization-context.service'
import { brandOfOrganization } from '@/ee/services/organization-brand.service'
import { removeStaff } from '@/ee/services/organization-staff.service'
import { ownsEmail } from '@/lib/auth/account-emails'
import { hostOrganizationId } from '@/lib/brand/request-site'
import { brandAppUrl } from '@/lib/brand/urls'
import { AppError } from '@/lib/i18n/action-error'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { randomUuid } from '@/lib/random-uuid'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectCount, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ORGANIZATIONS_ENABLED } from '@rerun/cloud/organizations'
import { EMAIL_DELIVERY, sendWorkspaceInviteEmail } from '@rerun/cloud/email'
import { after } from 'next/server'

type InvitationInsert = Database['public']['Tables']['organization_invitations']['Insert']
type InvitationUpdate = Database['public']['Tables']['organization_invitations']['Update']
type MemberInsert = Database['public']['Tables']['organization_members']['Insert']
type MemberUpdate = Database['public']['Tables']['organization_members']['Update']

const UNIQUE_VIOLATION = '23505'
const INVITATION_COLUMNS = ['id', 'organization_id', 'email', 'role', 'status', 'expires_at'] as const

export type TeamMember = { userId: string; email: string | null; name: string | null; avatarUrl: string | null; role: OrganizationRole }
export type TeamInvitation = { id: string; email: string; role: OrganizationRole; createdAt: string; expiresAt: string }
export type OrganizationTeam = { members: TeamMember[]; invitations: TeamInvitation[]; currentUserId: string; currentRole: OrganizationRole }

export async function listOrganizationTeam({ supabase, organization, userId, role }: OrganizationContext): Promise<OrganizationTeam> {
    const [{ data: memberRows, error }, { data: inviteRows, error: inviteError }] = await Promise.all([
        selectAll(supabase, 'organization_members', ['user_id', 'role'] as const, { organization_id: organization.id }, { column: 'created_at', ascending: true }),
        selectAll(supabase, 'organization_invitations', ['id', 'email', 'role', 'created_at', 'expires_at'] as const, { organization_id: organization.id, status: 'pending' }, { column: 'created_at', ascending: true }),
    ])
    if (error ?? inviteError) throw new Error((error ?? inviteError)?.message)
    const rows = memberRows ?? []
    const identities = await resolveMemberIdentities(supabase, rows.map(row => row.user_id))
    return {
        members: rows.map(row => ({ userId: row.user_id, email: identities.get(row.user_id)?.email ?? null, name: identities.get(row.user_id)?.name ?? null, avatarUrl: identities.get(row.user_id)?.avatarUrl ?? null, role: toOrganizationRole(row.role) })),
        invitations: (inviteRows ?? []).map(row => ({ id: row.id, email: row.email, role: toOrganizationRole(row.role), createdAt: row.created_at, expiresAt: row.expires_at })),
        currentUserId: userId,
        currentRole: role,
    }
}

export const teamInvitationPath = (token: string) => `/organization/invite/${token}`

// One invitation, or the pending one for that address, sent again with its new role and a full
// delay. `inviteUrl` comes back where no email leaves.
export async function inviteTeamMember(ctx: OrganizationContext, rawEmail: string, role: OrganizationRole): Promise<{ inviteUrl?: string }> {
    const { supabase, organization, userId, userEmail } = ctx
    const email = rawEmail.trim().toLowerCase()
    if (!isEmailAddress(email)) throw new AppError('invalidEmailShort')

    const { data: memberRows, error } = await selectAll(supabase, 'organization_members', ['user_id'] as const, { organization_id: organization.id })
    if (error) throw new Error(error.message)
    const identities = await resolveMemberIdentities(supabase, memberRows.map(row => row.user_id))
    if ([...identities.values()].some(identity => identity.email === email)) throw new AppError('alreadyTeamMember')

    const token = (await renewPending(ctx, email, role)) ?? (await insertInvitation(ctx, email, role))
    const brand = await brandOfOrganization(supabase, organization)
    const inviteUrl = `${brandAppUrl(brand)}${teamInvitationPath(token)}`
    const locale = await recipientLocale(supabase, userId, null)
    after(() => sendWorkspaceInviteEmail({ to: email, workspaceName: organization.name, inviteUrl, invitedByEmail: userEmail ?? undefined, locale, brand }))
    return EMAIL_DELIVERY ? {} : { inviteUrl }
}

const inviteDeadline = () => new Date(Date.now() + INVITE_TTL_MS).toISOString()

async function renewPending({ supabase, organization, userId }: OrganizationContext, email: string, role: OrganizationRole): Promise<string | null> {
    const { data, error } = await supabase
        .from('organization_invitations')
        .update<InvitationUpdate>({ role, expires_at: inviteDeadline(), invited_by: userId })
        .eq('organization_id', organization.id)
        .eq('email', email)
        .eq('status', 'pending')
        .select('token')
        .maybeSingle()
    if (error) throw new Error(error.message)
    return data?.token ?? null
}

async function insertInvitation(ctx: OrganizationContext, email: string, role: OrganizationRole): Promise<string> {
    const token = randomUuid()
    const { error } = await ctx.supabase.from('organization_invitations').insert<InvitationInsert>({ organization_id: ctx.organization.id, email, role, token, invited_by: ctx.userId, expires_at: inviteDeadline() })
    if (!error) return token
    // Two tabs inviting the same person: the second takes the first's invitation.
    const raced = error.code === UNIQUE_VIOLATION ? await renewPending(ctx, email, role) : null
    if (!raced) throw new Error(error.message)
    return raced
}

export async function revokeTeamInvitation({ supabase, organization }: OrganizationContext, invitationId: string): Promise<void> {
    const { data, error } = await supabase
        .from('organization_invitations')
        .update<InvitationUpdate>({ status: 'revoked' })
        .eq('id', invitationId)
        .eq('organization_id', organization.id)
        .eq('status', 'pending')
        .select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new AppError('invitationNotFound')
}

async function roleInTeam({ supabase, organization }: OrganizationContext, userId: string): Promise<OrganizationRole> {
    const { data, error } = await selectMaybeSingle(supabase, 'organization_members', ['role'] as const, { organization_id: organization.id, user_id: userId })
    if (error) throw new Error(error.message)
    if (!data) throw new AppError('teamMemberNotFound')
    return toOrganizationRole(data.role)
}

async function writeRole({ supabase, organization }: OrganizationContext, userId: string, role: OrganizationRole): Promise<void> {
    const { error } = await supabase.from('organization_members').update<MemberUpdate>({ role }).eq('organization_id', organization.id).eq('user_id', userId)
    if (error) throw new Error(error.message)
}

async function countOwners({ supabase, organization }: OrganizationContext): Promise<number> {
    const { data, error } = await selectCount(supabase, 'organization_members', { organization_id: organization.id, role: 'owner' })
    if (error || data === null) throw new Error(error?.message ?? 'Could not count the owners')
    return data
}

// Two owners stepping down at the same time both see the other, so the owners are counted again once
// the demotion is written: the one who finds none left takes the role back.
async function demoteKeepingAnOwner(ctx: OrganizationContext, userId: string): Promise<void> {
    if ((await countOwners(ctx)) <= 1) throw new AppError('organizationNeedsOwner')
    await writeRole(ctx, userId, 'admin')
    if ((await countOwners(ctx)) > 0) return
    await writeRole(ctx, userId, 'owner')
    throw new AppError('organizationNeedsOwner')
}

export async function setTeamMemberRole(ctx: OrganizationContext, userId: string, role: OrganizationRole): Promise<void> {
    const current = await roleInTeam(ctx, userId)
    if (current === role) return
    if (role === 'admin') await demoteKeepingAnOwner(ctx, userId)
    else await writeRole(ctx, userId, role)
}

// An owner is demoted before being removed, which is what keeps one. Off the team first, out of the
// clients' workspaces next: nothing can open one in between.
export async function removeTeamMember(ctx: OrganizationContext, userId: string): Promise<void> {
    if ((await roleInTeam(ctx, userId)) === 'owner') await demoteKeepingAnOwner(ctx, userId)
    const { error } = await ctx.supabase.from('organization_members').delete().eq('organization_id', ctx.organization.id).eq('user_id', userId)
    if (error) throw new Error(error.message)
    await removeStaff(ctx.supabase, ctx.organization.id, userId)
}

// On an organization's address, another one's invitation answers like one that does not exist.
async function readInvitation(token: string) {
    const { data, error } = await selectMaybeSingle(createServiceRoleClient(), 'organization_invitations', INVITATION_COLUMNS, { token })
    if (error) throw new Error(error.message)
    const here = await hostOrganizationId()
    return data && (here === null || here === data.organization_id) ? data : null
}

export type TeamInvitationView = { status: 'ok'; email: string; organizationName: string } | { status: 'not_found' } | { status: 'unavailable' } | { status: 'expired' }

export async function viewTeamInvitation(token: string): Promise<TeamInvitationView> {
    const invite = ORGANIZATIONS_ENABLED ? await readInvitation(token) : null
    if (!invite) return { status: 'not_found' }
    if (invite.status !== 'pending') return { status: 'unavailable' }
    if (new Date(invite.expires_at).getTime() < Date.now()) return { status: 'expired' }
    const { data: organization } = await readOrganization(createServiceRoleClient(), invite.organization_id)
    return organization ? { status: 'ok', email: invite.email, organizationName: organization.name } : { status: 'not_found' }
}

// `account` as the auth server holds it, whose linked addresses count too.
export async function acceptTeamInvitation(account: User, token: string): Promise<{ organizationId: string }> {
    const supabase = createServiceRoleClient()
    const invite = ORGANIZATIONS_ENABLED ? await readInvitation(token) : null
    if (!invite) throw new AppError('invitationNotFound')
    if (!ownsEmail(account, invite.email)) throw new AppError('invitationForEmail', { email: invite.email })
    if (invite.status === 'accepted' && (await isInTeam(invite.organization_id, account.id))) return { organizationId: invite.organization_id }
    if (invite.status !== 'pending') throw new AppError('invitationInvalid')
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new AppError('invitationExpired')
    const { data: organization } = await readOrganization(supabase, invite.organization_id)
    if (organization?.status !== 'active') throw new AppError('organizationSuspended')

    // Claimed before the row is written: of two tabs, or of an acceptance and a revocation, one wins.
    const { data: claimed, error } = await supabase
        .from('organization_invitations')
        .update<InvitationUpdate>({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id)
        .eq('status', 'pending')
        .select('role')
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!claimed) throw new AppError('invitationInvalid')

    const { error: memberError } = await supabase
        .from('organization_members')
        .upsert<MemberInsert>({ organization_id: invite.organization_id, user_id: account.id, role: claimed.role }, { onConflict: 'organization_id,user_id', ignoreDuplicates: true })
    if (memberError) {
        await supabase.from('organization_invitations').update<InvitationUpdate>({ status: 'pending', accepted_at: null }).eq('id', invite.id).eq('status', 'accepted')
        throw new Error(memberError.message)
    }
    return { organizationId: invite.organization_id }
}

export async function isInTeam(organizationId: string, userId: string): Promise<boolean> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'organization_members', ['user_id'] as const, { organization_id: organizationId, user_id: userId })
    return data !== null
}
