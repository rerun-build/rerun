'use server'

import { z } from 'zod'

import { AuthorizationError } from '@/app/api/_auth/errors'
import type { InviteEntry, MemberEntry } from '@/app/api/_services/members.service'
import type { CreditUsage } from '@/ee/lib/billing/credit-usage'
import { getCreditUsage } from '@/ee/services/credit-usage.service'
import { brandOfOrganization } from '@/ee/services/organization-brand.service'
import { requireActiveOrganization, requireOrganizationContext, requireOrganizationWorkspace } from '@/ee/services/organization-context.service'
import { allocateOrganizationCredit, loadOrganizationCredit, MAX_CREDITS_PER_MOVEMENT, takeBackOrganizationCredit, type OrganizationCredit } from '@/ee/services/organization-credit.service'
import { addOrganizationDomain, checkOrganizationDomain, listOrganizationDomains, removeOrganizationDomain, type OrganizationDomains } from '@/ee/services/organization-domains.service'
import { inviteOrganizationWorkspaceMember, listOrganizationWorkspaceMembers, removeOrganizationWorkspaceMember, revokeOrganizationWorkspaceInvitation, setOrganizationWorkspaceMemberRole } from '@/ee/services/organization-members.service'
import { loadOrganizationBrandSettings, updateOrganizationBrand, type OrganizationBrandSettings } from '@/ee/services/organization-settings.service'
import { openOrganizationWorkspace } from '@/ee/services/organization-staff.service'
import { acceptTeamInvitation, inviteTeamMember, listOrganizationTeam, removeTeamMember, revokeTeamInvitation, setTeamMemberRole, viewTeamInvitation, type OrganizationTeam, type TeamInvitationView } from '@/ee/services/organization-team.service'
import {
    archiveOrganizationWorkspace,
    createOrganizationWorkspace,
    deleteOrganizationWorkspace,
    listOrganizationWorkspaces,
    loadOrganizationWorkspace,
    restartOrganizationWorkspace,
    restoreOrganizationWorkspace,
    updateOrganizationWorkspace,
    type OrganizationWorkspaceDetail,
    type OrganizationWorkspaceSummary,
} from '@/ee/services/organization-workspaces.service'
import { hostOrganizationId } from '@/lib/brand/request-site'
import { AppError, failure, type ActionFailure, type ErrorCode } from '@/lib/i18n/action-error'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { getAuthUser } from '@/supabase/session/getServerSession'

type Result<T = unknown> = ({ ok: true } & T) | ActionFailure

const workspaceIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const uuidSchema = z.guid()
const emailSchema = z.string().max(320)
const workspaceRoleSchema = z.enum(['admin', 'member'])
const boxScopeSchema = z.enum(['all', 'assigned'])
const teamRoleSchema = z.enum(['owner', 'admin'])
const tokenSchema = z.string().min(1).max(100)
const creditChangeSchema = z.object({ workspaceId: workspaceIdSchema, credits: z.number().int().min(1).max(MAX_CREDITS_PER_MOVEMENT), requestId: uuidSchema })
const hostnameSchema = z.string().max(300)
const seqSchema = z.number().int().positive().optional()

// What a person in an agency reads is one of ours: a database or a machine error stays in the logs.
function refused(err: unknown, fallback: ErrorCode = 'generic'): ActionFailure {
    if (err instanceof AppError) return failure(err.code, err.params)
    if (err instanceof z.ZodError) return failure('invalidRequest')
    console.error('[organizations] action failed', err)
    return failure(fallback)
}

function answered(result: { ok: true; inviteUrl?: string } | ActionFailure | { ok: false; code: ErrorCode }): Result<{ inviteUrl?: string }> {
    if (result.ok) return result
    if (result.code) return failure(result.code, 'params' in result ? result.params : undefined)
    console.error('[organizations] action failed', result)
    return failure('generic')
}

export async function listOrganizationWorkspacesAction(): Promise<Result<{ workspaces: OrganizationWorkspaceSummary[]; maxWorkspaces: number }>> {
    try {
        const ctx = await requireOrganizationContext()
        return { ok: true, workspaces: await listOrganizationWorkspaces(ctx), maxWorkspaces: ctx.organization.max_workspaces }
    } catch (err) {
        return refused(err)
    }
}

export async function loadOrganizationWorkspaceAction(workspaceId: number): Promise<Result<{ workspace: OrganizationWorkspaceDetail }>> {
    try {
        const ctx = await requireOrganizationContext()
        return { ok: true, workspace: await loadOrganizationWorkspace(ctx, workspaceIdSchema.parse(workspaceId)) }
    } catch (err) {
        return refused(err)
    }
}

export async function loadOrganizationWorkspaceUsageAction(workspaceId: number): Promise<Result<{ usage: CreditUsage }>> {
    try {
        const ctx = await requireOrganizationContext()
        const { id } = await requireOrganizationWorkspace(ctx, workspaceIdSchema.parse(workspaceId))
        return { ok: true, usage: await getCreditUsage(ctx.supabase, { kind: 'workspace', workspaceId: id }) }
    } catch (err) {
        return refused(err, 'loadCreditUsageFailed')
    }
}

// name, adminEmail, locale and the logo of a workspace form (iconFile, logoFile or logoLink).
export async function createOrganizationWorkspaceAction(formData: FormData): Promise<Result<{ workspaceId: number; inviteUrl?: string }>> {
    try {
        const ctx = await requireActiveOrganization()
        return { ok: true, ...(await createOrganizationWorkspace(ctx, z.instanceof(FormData).parse(formData))) }
    } catch (err) {
        return refused(err, 'createWorkspaceFailed')
    }
}

export async function updateOrganizationWorkspaceAction(workspaceId: number, formData: FormData): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        await updateOrganizationWorkspace(ctx, workspaceIdSchema.parse(workspaceId), z.instanceof(FormData).parse(formData))
        return { ok: true }
    } catch (err) {
        return refused(err)
    }
}

export async function archiveOrganizationWorkspaceAction(workspaceId: number): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        await archiveOrganizationWorkspace(ctx, workspaceIdSchema.parse(workspaceId))
        return { ok: true }
    } catch (err) {
        return refused(err)
    }
}

export async function restoreOrganizationWorkspaceAction(workspaceId: number): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        await restoreOrganizationWorkspace(ctx, workspaceIdSchema.parse(workspaceId))
        return { ok: true }
    } catch (err) {
        return refused(err)
    }
}

export async function restartOrganizationWorkspaceAction(workspaceId: number): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        await restartOrganizationWorkspace(ctx, workspaceIdSchema.parse(workspaceId))
        return { ok: true }
    } catch (err) {
        return refused(err, 'restartMachineFailed')
    }
}

export async function deleteOrganizationWorkspaceAction(workspaceId: number): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        await deleteOrganizationWorkspace(ctx, workspaceIdSchema.parse(workspaceId))
        return { ok: true }
    } catch (err) {
        return refused(err, 'deleteWorkspaceFailed')
    }
}

// Makes it the caller's workspace: the screen then goes to `/`, or to `url` from a host that does not
// open it.
export async function openOrganizationWorkspaceAction(workspaceId: number): Promise<Result<{ url?: string }>> {
    try {
        const ctx = await requireActiveOrganization()
        const id = workspaceIdSchema.parse(workspaceId)
        await openOrganizationWorkspace(ctx, id)
        const { appUrl } = await brandOfOrganization(ctx.supabase, ctx.organization)
        const elsewhere = appUrl !== null && (await hostOrganizationId()) !== ctx.organization.id
        return { ok: true, ...(elsewhere ? { url: `${appUrl}/?${WORKSPACE_PARAM}=${id}` } : {}) }
    } catch (err) {
        return refused(err)
    }
}

export async function listOrganizationWorkspaceMembersAction(workspaceId: number): Promise<Result<{ members: MemberEntry[]; invites: InviteEntry[] }>> {
    try {
        const ctx = await requireOrganizationContext()
        return { ok: true, ...(await listOrganizationWorkspaceMembers(ctx, workspaceIdSchema.parse(workspaceId))) }
    } catch (err) {
        return refused(err, 'loadMembersFailed')
    }
}

export async function inviteOrganizationWorkspaceMemberAction(workspaceId: number, email: string, role: 'admin' | 'member', boxScope: 'all' | 'assigned' = 'all'): Promise<Result<{ inviteUrl?: string }>> {
    try {
        const ctx = await requireActiveOrganization()
        return answered(await inviteOrganizationWorkspaceMember(ctx, workspaceIdSchema.parse(workspaceId), emailSchema.parse(email), workspaceRoleSchema.parse(role), boxScopeSchema.parse(boxScope)))
    } catch (err) {
        return refused(err, 'sendInvitationFailed')
    }
}

export async function revokeOrganizationWorkspaceInvitationAction(workspaceId: number, invitationId: string): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        return answered(await revokeOrganizationWorkspaceInvitation(ctx, workspaceIdSchema.parse(workspaceId), uuidSchema.parse(invitationId)))
    } catch (err) {
        return refused(err, 'revokeInvitationFailed')
    }
}

export async function removeOrganizationWorkspaceMemberAction(workspaceId: number, userId: string): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        return answered(await removeOrganizationWorkspaceMember(ctx, workspaceIdSchema.parse(workspaceId), uuidSchema.parse(userId)))
    } catch (err) {
        return refused(err, 'removeMemberFailed')
    }
}

export async function setOrganizationWorkspaceMemberRoleAction(workspaceId: number, userId: string, role: 'admin' | 'member'): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        return answered(await setOrganizationWorkspaceMemberRole(ctx, workspaceIdSchema.parse(workspaceId), uuidSchema.parse(userId), workspaceRoleSchema.parse(role)))
    } catch (err) {
        return refused(err, 'changeRoleFailed')
    }
}

export async function loadOrganizationCreditAction(beforeSeq?: number): Promise<Result<OrganizationCredit>> {
    try {
        const ctx = await requireOrganizationContext()
        return { ok: true, ...(await loadOrganizationCredit(ctx, seqSchema.parse(beforeSeq))) }
    } catch (err) {
        return refused(err, 'loadCreditUsageFailed')
    }
}

// `requestId` is drawn by the screen when the dialog opens, and kept for every retry of that intent.
export async function allocateOrganizationCreditAction(change: { workspaceId: number; credits: number; requestId: string }): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization()
        await allocateOrganizationCredit(ctx, creditChangeSchema.parse(change))
        return { ok: true }
    } catch (err) {
        return refused(err, 'organizationCreditFailed')
    }
}

export async function takeBackOrganizationCreditAction(change: { workspaceId: number; credits: number; requestId: string }): Promise<Result<{ micros: number }>> {
    try {
        const ctx = await requireActiveOrganization()
        return { ok: true, micros: await takeBackOrganizationCredit(ctx, creditChangeSchema.parse(change)) }
    } catch (err) {
        return refused(err, 'organizationCreditFailed')
    }
}

export async function listOrganizationTeamAction(): Promise<Result<OrganizationTeam>> {
    try {
        const ctx = await requireOrganizationContext()
        return { ok: true, ...(await listOrganizationTeam(ctx)) }
    } catch (err) {
        return refused(err, 'loadMembersFailed')
    }
}

export async function inviteOrganizationTeamMemberAction(email: string, role: 'owner' | 'admin'): Promise<Result<{ inviteUrl?: string }>> {
    try {
        const ctx = await requireActiveOrganization('owner')
        return { ok: true, ...(await inviteTeamMember(ctx, emailSchema.parse(email), teamRoleSchema.parse(role))) }
    } catch (err) {
        return refused(err, 'sendInvitationFailed')
    }
}

export async function revokeOrganizationTeamInvitationAction(invitationId: string): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization('owner')
        await revokeTeamInvitation(ctx, uuidSchema.parse(invitationId))
        return { ok: true }
    } catch (err) {
        return refused(err, 'revokeInvitationFailed')
    }
}

export async function setOrganizationTeamRoleAction(userId: string, role: 'owner' | 'admin'): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization('owner')
        await setTeamMemberRole(ctx, uuidSchema.parse(userId), teamRoleSchema.parse(role))
        return { ok: true }
    } catch (err) {
        return refused(err, 'changeRoleFailed')
    }
}

export async function removeOrganizationTeamMemberAction(userId: string): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization('owner')
        await removeTeamMember(ctx, uuidSchema.parse(userId))
        return { ok: true }
    } catch (err) {
        return refused(err, 'removeMemberFailed')
    }
}

// Whoever holds the link reads the name and the address it was sent to, like a workspace's invitation.
export async function loadOrganizationInvitationAction(token: string): Promise<TeamInvitationView> {
    const parsed = tokenSchema.safeParse(token)
    return parsed.success ? viewTeamInvitation(parsed.data) : { status: 'not_found' }
}

export async function acceptOrganizationInvitationAction(token: string): Promise<Result<{ organizationId: string }>> {
    try {
        const account = await getAuthUser()
        if (!account?.email) throw new AuthorizationError('signInToAcceptInvitation')
        return { ok: true, ...(await acceptTeamInvitation(account, tokenSchema.parse(token))) }
    } catch (err) {
        return refused(err)
    }
}

export async function loadOrganizationBrandAction(): Promise<Result<OrganizationBrandSettings>> {
    try {
        return { ok: true, ...(await loadOrganizationBrandSettings(await requireOrganizationContext())) }
    } catch (err) {
        return refused(err)
    }
}

// name, color, supportEmail, docsUrl, termsUrl, privacyUrl, and `icon` when another one was picked.
export async function updateOrganizationBrandAction(formData: FormData): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization('owner')
        await updateOrganizationBrand(ctx, z.instanceof(FormData).parse(formData))
        return { ok: true }
    } catch (err) {
        return refused(err)
    }
}

export async function listOrganizationDomainsAction(): Promise<Result<OrganizationDomains>> {
    try {
        return { ok: true, ...(await listOrganizationDomains(await requireOrganizationContext())) }
    } catch (err) {
        return refused(err)
    }
}

export async function addOrganizationDomainAction(hostname: string): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization('owner')
        await addOrganizationDomain(ctx, hostnameSchema.parse(hostname))
        return { ok: true }
    } catch (err) {
        return refused(err)
    }
}

export async function checkOrganizationDomainAction(domainId: string): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization('owner')
        await checkOrganizationDomain(ctx, uuidSchema.parse(domainId))
        return { ok: true }
    } catch (err) {
        return refused(err)
    }
}

export async function removeOrganizationDomainAction(domainId: string): Promise<Result> {
    try {
        const ctx = await requireActiveOrganization('owner')
        await removeOrganizationDomain(ctx, uuidSchema.parse(domainId))
        return { ok: true }
    } catch (err) {
        return refused(err)
    }
}
