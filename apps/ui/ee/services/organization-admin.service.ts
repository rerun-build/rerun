import 'server-only'
import type { SupabaseClient, User } from '@supabase/supabase-js'

import { reconcileAgentActivation } from '@/app/api/_services/agent-activation.service'
import { isEmailAddress, resolveMemberIdentities } from '@/app/api/_services/members.service'
import { countWorkspaceMembers, selectWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import type { Database } from '@/app/api/database.types'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { BASE_PLAN_SLUG, baseLimitsToColumns, isLifetimePlan, ORGANIZATION_PLAN_SLUG, organizationLimitsToColumns } from '@/ee/lib/billing/plans'
import { stripe } from '@/ee/lib/billing/stripe'
import { slugProblem } from '@/ee/lib/organizations/slugs'
import { readOrganization, requireOrganizationWorkspace, toOrganizationRole, type OrganizationContext, type OrganizationRow } from '@/ee/services/organization-context.service'
import { reserveBalanceMicros, returnAllocatedCredit } from '@/ee/services/organization-credit.service'
import { removeStaffFromWorkspace } from '@/ee/services/organization-staff.service'
import { inviteTeamMember, revokeTeamInvitation, setTeamMemberRole } from '@/ee/services/organization-team.service'
import { assertMachineIdle, assertStillAllowed, countWorkspaces, limitReached, startRunning } from '@/ee/services/organization-workspaces.service'
import { ownsEmail } from '@/lib/auth/account-emails'
import { AppError } from '@/lib/i18n/action-error'
import { selectAll, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { requestAgentActivationSync } from '@/trigger/sync-agent-activation'

// What Rerun itself does to an organization, from the back office. None of it asks who the caller is:
// the action that calls it has checked an admin of Rerun.

type Client = SupabaseClient<Database>
type OrganizationInsert = Database['public']['Tables']['organizations']['Insert']
type OrganizationUpdate = Database['public']['Tables']['organizations']['Update']
type MemberInsert = Database['public']['Tables']['organization_members']['Insert']
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

const UNIQUE_VIOLATION = '23505'
const AUTH_LIST_PAGE = 1000

export type OrganizationAdminReason = 'organizationNotFound' | 'slugInvalid' | 'slugReserved' | 'slugTaken' | 'alreadyOwner' | 'workspaceNotFound' | 'workspaceChanged' | 'noClientAdmin' | AttachRefusal

// Read by the back office alone, which words it.
export class OrganizationAdminError extends Error {
    constructor(readonly reason: OrganizationAdminReason) {
        super(reason)
    }
}

export type RerunAdmin = { userId: string; email: string | null }

// An organization as Rerun handles it: every right of an owner, on behalf of the person in the back office.
export async function rerunOrganizationContext(supabase: Client, admin: RerunAdmin, organizationId: string): Promise<OrganizationContext> {
    const { data: organization, error } = await readOrganization(supabase, organizationId)
    if (error) throw new Error(error.message)
    if (!organization) throw new OrganizationAdminError('organizationNotFound')
    return { organization, role: 'owner', userId: admin.userId, userEmail: admin.email, supabase }
}

export type OrganizationOwner = { userId: string; email: string | null }

export type OrganizationOverview = {
    id: string
    name: string
    slug: string
    status: OrganizationRow['status']
    iconUrl: string | null
    createdAt: string
    maxWorkspaces: number
    workspaceCount: number
    balanceMicros: number
    owners: OrganizationOwner[]
    invitedOwners: string[]
}

const OVERVIEW_COLUMNS = ['id', 'name', 'slug', 'status', 'icon_url', 'max_workspaces', 'created_at'] as const

export async function listOrganizations(supabase: Client): Promise<OrganizationOverview[]> {
    const [organizations, owners, invitations, workspaces] = await Promise.all([
        selectAll(supabase, 'organizations', OVERVIEW_COLUMNS, {}, { column: 'created_at', ascending: false }),
        selectAll(supabase, 'organization_members', ['organization_id', 'user_id'] as const, { role: 'owner' }, { column: 'created_at', ascending: true }),
        selectAll(supabase, 'organization_invitations', ['organization_id', 'email'] as const, { role: 'owner', status: 'pending' }, { column: 'created_at', ascending: true }),
        selectAll(supabase, 'workspaces', ['organization_id'] as const, { organization_id: { notNull: true } }),
    ])
    const error = organizations.error ?? owners.error ?? invitations.error ?? workspaces.error
    if (error) throw new Error(error.message)

    const identities = await resolveMemberIdentities(supabase, [...new Set((owners.data ?? []).map(owner => owner.user_id))])
    return Promise.all(
        (organizations.data ?? []).map(async row => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            status: row.status,
            iconUrl: row.icon_url,
            createdAt: row.created_at,
            maxWorkspaces: row.max_workspaces,
            workspaceCount: (workspaces.data ?? []).filter(workspace => workspace.organization_id === row.id).length,
            balanceMicros: await reserveBalanceMicros(supabase, row.id),
            owners: (owners.data ?? []).filter(owner => owner.organization_id === row.id).map(owner => ({ userId: owner.user_id, email: identities.get(owner.user_id)?.email ?? null })),
            invitedOwners: (invitations.data ?? []).filter(invitation => invitation.organization_id === row.id).map(invitation => invitation.email),
        })),
    )
}

function assertSlug(slug: string): void {
    const problem = slugProblem(slug)
    if (problem) throw new OrganizationAdminError(problem === 'reserved' ? 'slugReserved' : 'slugInvalid')
}

// `inviteUrl` comes back where no email leaves.
export type OwnerOutcome = { joined: true } | { joined: false; inviteUrl?: string }

export type NewOrganization = { name: string; slug: string; maxWorkspaces: number; ownerEmail: string }

export async function createOrganization(supabase: Client, admin: RerunAdmin, { name, slug, maxWorkspaces, ownerEmail }: NewOrganization): Promise<{ organizationId: string; owner: OwnerOutcome }> {
    assertSlug(slug)
    if (!isEmailAddress(ownerEmail.trim())) throw new AppError('invalidEmailShort')

    const { data: created, error } = await supabase.from('organizations').insert<OrganizationInsert>({ name: name.trim(), slug, max_workspaces: maxWorkspaces }).select('id').single()
    if (error?.code === UNIQUE_VIOLATION) throw new OrganizationAdminError('slugTaken')
    if (error || !created) throw new Error(error?.message ?? 'The organization was not written')

    try {
        return { organizationId: created.id, owner: await addOrganizationOwner(await rerunOrganizationContext(supabase, admin, created.id), ownerEmail) }
    } catch (err) {
        await supabase.from('organizations').delete().eq('id', created.id)
        throw err
    }
}

export type OrganizationSettings = { name: string; slug: string; maxWorkspaces: number }

// A lower maximum takes nothing away: it stops the next workspace.
export async function updateOrganization({ supabase, organization }: OrganizationContext, { name, slug, maxWorkspaces }: OrganizationSettings): Promise<void> {
    if (slug !== organization.slug) assertSlug(slug)
    const { error } = await supabase.from('organizations').update<OrganizationUpdate>({ name: name.trim(), slug, max_workspaces: maxWorkspaces }).eq('id', organization.id)
    if (error?.code === UNIQUE_VIOLATION) throw new OrganizationAdminError('slugTaken')
    if (error) throw new Error(error.message)
}

// An address counts once the account has proven it: whoever merely typed it would be handed the
// organization. An account that never reached the app has no row to make a member of.
async function findAccount(supabase: Client, email: string): Promise<User | null> {
    for (let page = 1; ; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: AUTH_LIST_PAGE })
        if (error) throw new Error(error.message)
        const account = data.users.find(user => !user.is_anonymous && ownsEmail(user, email) && (user.email?.toLowerCase() !== email || user.email_confirmed_at))
        if (account) {
            const { data: row } = await selectMaybeSingle(supabase, 'users', ['id'] as const, { id: account.id, deleted_at: { isNull: true } })
            return row ? account : null
        }
        if (data.users.length < AUTH_LIST_PAGE) return null
    }
}

// Someone with an account is in at once; anyone else gets the team's invitation.
export async function addOrganizationOwner(ctx: OrganizationContext, rawEmail: string): Promise<OwnerOutcome> {
    const { supabase, organization } = ctx
    const email = rawEmail.trim().toLowerCase()
    if (!isEmailAddress(email)) throw new AppError('invalidEmailShort')

    const account = await findAccount(supabase, email)
    if (!account) return { joined: false, ...(await inviteTeamMember(ctx, email, 'owner')) }

    const { data: member, error: memberError } = await selectMaybeSingle(supabase, 'organization_members', ['role'] as const, { organization_id: organization.id, user_id: account.id })
    if (memberError) throw new Error(memberError.message)
    if (member && toOrganizationRole(member.role) === 'owner') throw new OrganizationAdminError('alreadyOwner')

    if (member) await setTeamMemberRole(ctx, account.id, 'owner')
    else {
        const { error } = await supabase.from('organization_members').upsert<MemberInsert>({ organization_id: organization.id, user_id: account.id, role: 'owner' }, { onConflict: 'organization_id,user_id' })
        if (error) throw new Error(error.message)
    }
    await dropPendingInvitation(ctx, email)
    return { joined: true }
}

async function dropPendingInvitation(ctx: OrganizationContext, email: string): Promise<void> {
    const { data } = await selectMaybeSingle(ctx.supabase, 'organization_invitations', ['id'] as const, { organization_id: ctx.organization.id, email, status: 'pending' })
    if (data) await revokeTeamInvitation(ctx, data.id)
}

export type AttachRefusal = 'inOrganization' | 'sandbox' | 'lifetime' | 'subscription'

const ATTACH_COLUMNS = [
    'id',
    'name',
    'plan',
    'is_sandbox',
    'organization_id',
    'organization_archived_at',
    'subscription_status',
    'stripe_customer_id',
    'stripe_subscription_id',
    'stripe_addons_subscription_id',
    'stripe_price_id',
    'current_period_end',
    'addons_current_period_end',
    'subscription_cancel_at',
    'payment_failed_at',
    'renewal_reminder_at',
    'renewal_reminder_user_id',
    'max_agents',
    'max_seats',
    'model_access',
    'custom_integrations',
    'api_access',
    'rerun_budget_micros',
    'rerun_used_micros',
    'rerun_topup_micros',
    'rerun_period_anchor',
    'rerun_credit_paused_at',
    'boxes_archived_at',
] as const

type AttachRow = Pick<Database['public']['Tables']['workspaces']['Row'], (typeof ATTACH_COLUMNS)[number]>

export function attachRefusal(workspace: Pick<AttachRow, 'organization_id' | 'is_sandbox' | 'plan' | 'subscription_status' | 'stripe_subscription_id' | 'stripe_addons_subscription_id'>): AttachRefusal | null {
    if (workspace.organization_id) return 'inOrganization'
    if (workspace.is_sandbox) return 'sandbox'
    if (isLifetimePlan(workspace)) return 'lifetime'
    // An access offered by hand is `active` with nothing at Stripe behind it.
    const offered = workspace.subscription_status === 'active' && !workspace.stripe_subscription_id
    if ((isSubscriptionEntitled(workspace.subscription_status) && !offered) || workspace.stripe_addons_subscription_id) return 'subscription'
    return null
}

export type AttachCandidate = { id: number; name: string | null; plan: string; status: string | null; ownerEmail: string | null; stripeCustomerId: string | null; refusal: AttachRefusal | null }

const CANDIDATES = 8

// By name, or by id ("#12").
export async function findAttachableWorkspaces(supabase: Client, rawQuery: string): Promise<AttachCandidate[]> {
    const query = rawQuery.trim()
    const id = Number(query.replace(/^#/, ''))
    const isId = Number.isSafeInteger(id) && id > 0
    if (!isId && query.length < 2) return []

    const [byId, byName] = await Promise.all([
        isId ? selectMany(supabase, 'workspaces', ATTACH_COLUMNS, { id }) : null,
        query.startsWith('#') ? null : selectMany(supabase, 'workspaces', ATTACH_COLUMNS, { name: { ilike: `%${query.replace(/[\\%_]/g, '\\$&')}%` } }, { column: 'id', ascending: false }, CANDIDATES),
    ])
    const error = byId?.error ?? byName?.error
    if (error) throw new Error(error.message)
    const found = new Map([...(byId?.data ?? []), ...(byName?.data ?? [])].map(row => [row.id, row]))
    const rows = [...found.values()].slice(0, CANDIDATES)
    if (rows.length === 0) return []

    const { data: members } = await selectWorkspaceMembers(supabase, ['workspace_id', 'user_id'] as const, { workspace_id: rows.map(row => row.id) })
    const ownerOf = new Map<number, string>()
    for (const member of members ?? []) if (!ownerOf.has(member.workspace_id)) ownerOf.set(member.workspace_id, member.user_id)
    const identities = await resolveMemberIdentities(supabase, [...new Set(ownerOf.values())])

    return rows.map(row => ({ id: row.id, name: row.name, plan: row.plan, status: row.subscription_status, ownerEmail: identities.get(ownerOf.get(row.id) ?? '')?.email ?? null, stripeCustomerId: row.stripe_customer_id, refusal: attachRefusal(row) }))
}

const SETTLED_STATUSES = new Set(['canceled', 'incomplete_expired'])

// Asked to Stripe itself: a subscription the workspace lost track of would keep charging its client,
// and its next event would write the plan over the organization's.
async function hasLiveSubscription(customerId: string | null): Promise<boolean> {
    if (!customerId) return false
    const { data } = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    return data.some(subscription => !SETTLED_STATUSES.has(subscription.status))
}

// What the workspace bought itself stays its own; the credit of a trial or of an offer does not come
// along, or the organization could take it into its reserve. The balance does not tell which credit
// was spent, so it keeps up to what was bought.
async function purchasedMicros(supabase: Client, workspaceId: number): Promise<number> {
    const { data, error } = await selectAll(supabase, 'rerun_credit_purchases', ['micros', 'refunded_micros'] as const, { workspace_id: workspaceId })
    if (error) throw new Error(error.message)
    return data.reduce((sum, purchase) => sum + purchase.micros - purchase.refunded_micros, 0)
}

// An existing workspace joins the organization, which pays for it from now on: its people, its
// coworkers and its machine stay as they are, an archived machine comes back. Its Stripe customer is
// kept for the invoices it already has, with nothing left on it to charge.
export async function attachWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<void> {
    const { supabase, organization } = ctx
    if (organization.status !== 'active') throw new AppError('organizationSuspended')
    const { data: before, error } = await selectMaybeSingle(supabase, 'workspaces', ATTACH_COLUMNS, { id: workspaceId })
    if (error) throw new Error(error.message)
    if (!before) throw new OrganizationAdminError('workspaceNotFound')

    const refusal = attachRefusal(before)
    if (refusal) throw new OrganizationAdminError(refusal)
    if (await hasLiveSubscription(before.stripe_customer_id)) throw new OrganizationAdminError('subscription')
    if ((await countWorkspaces(supabase, organization.id)) >= organization.max_workspaces) throw limitReached(organization.max_workspaces)
    await assertMachineIdle(supabase, workspaceId)

    const update = {
        organization_id: organization.id,
        organization_archived_at: null,
        plan: ORGANIZATION_PLAN_SLUG,
        ...organizationLimitsToColumns(),
        subscription_status: 'active',
        stripe_subscription_id: null,
        stripe_addons_subscription_id: null,
        stripe_price_id: null,
        current_period_end: null,
        addons_current_period_end: null,
        subscription_cancel_at: null,
        payment_failed_at: null,
        renewal_reminder_at: null,
        renewal_reminder_user_id: null,
        rerun_used_micros: 0,
        rerun_topup_micros: Math.min(before.rerun_topup_micros, await purchasedMicros(supabase, workspaceId)),
        rerun_period_anchor: new Date().toISOString(),
        rerun_credit_paused_at: null,
    } satisfies WorkspaceUpdate

    // Over the row it was decided from: a checkout completed meanwhile, or the other tab, starts over.
    const claim = supabase.from('workspaces').update<WorkspaceUpdate>(update).eq('id', workspaceId).is('organization_id', null).eq('is_sandbox', false).eq('plan', before.plan)
    const unchanged = before.subscription_status === null ? claim.is('subscription_status', null) : claim.eq('subscription_status', before.subscription_status)
    const { data: claimed, error: claimError } = await unchanged.select('id')
    if (claimError) throw new Error(claimError.message)
    if (!claimed?.length) throw new OrganizationAdminError('workspaceChanged')

    try {
        await assertStillAllowed(supabase, organization.id)
    } catch (err) {
        const restored = Object.fromEntries(Object.keys(update).map(column => [column, before[column as keyof AttachRow]])) as WorkspaceUpdate
        const { error: restoreError } = await supabase.from('workspaces').update<WorkspaceUpdate>(restored).eq('id', workspaceId).eq('organization_id', organization.id)
        if (restoreError) console.error('[organizations] a refused workspace stayed in the organization', { workspaceId, restoreError })
        throw err
    }
    await startRunning(before)
}

// Out of the organization, the workspace is its own people's again, with no access: their coworkers
// stop, the machine is archived like any workspace's that ended, and a plan of their own brings it all
// back. Nothing is deleted. Its team loses its way in, and the credit it handed out and that was not
// spent returns to its reserve. Refused with nobody of the client's inside: it would be nobody's.
export async function detachWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<void> {
    const { supabase, organization } = ctx
    const workspace = await requireOrganizationWorkspace(ctx, workspaceId)
    const { data: admins, error: adminsError } = await countWorkspaceMembers(supabase, { workspace_id: workspaceId, role: 'admin' })
    if (adminsError) throw new Error(adminsError.message)
    if (!admins) throw new OrganizationAdminError('noClientAdmin')
    await assertMachineIdle(supabase, workspaceId)

    const { error: cutError } = await supabase.from('workspaces').update<WorkspaceUpdate>({ subscription_status: 'canceled' }).eq('id', workspaceId).eq('organization_id', organization.id)
    if (cutError) throw new Error(cutError.message)
    await returnAllocatedCredit(ctx, workspace)
    // While it can still be detached again should this fail, then once more for anyone who opened it in
    // between.
    await removeStaffFromWorkspace(supabase, workspaceId)

    const { error } = await supabase
        .from('workspaces')
        .update<WorkspaceUpdate>({ organization_id: null, organization_archived_at: null, plan: BASE_PLAN_SLUG, ...baseLimitsToColumns(), rerun_budget_micros: 0, subscription_status: 'canceled' })
        .eq('id', workspaceId)
        .eq('organization_id', organization.id)
    if (error) throw new Error(error.message)

    await removeStaffFromWorkspace(supabase, workspaceId)
    await requestAgentActivationSync(await reconcileAgentActivation(workspaceId))
}
