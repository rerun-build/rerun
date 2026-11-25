import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'
import type { Database } from '@/app/api/database.types'
import { realEmail } from '@/lib/auth/placeholder-email'
import { getBrand } from '@/lib/brand/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getSessionIdentity } from '@/supabase/session/getServerSession'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ORGANIZATIONS_ENABLED } from '@rerun/cloud/organizations'

export type OrganizationRole = 'owner' | 'admin'

const ORGANIZATION_COLUMNS = ['id', 'name', 'slug', 'status', 'max_workspaces', 'icon_url', 'color', 'support_email', 'docs_url', 'terms_url', 'privacy_url'] as const

export type OrganizationRow = Pick<Database['public']['Tables']['organizations']['Row'], (typeof ORGANIZATION_COLUMNS)[number]>

export type OrganizationContext = {
    organization: OrganizationRow
    role: OrganizationRole
    userId: string
    userEmail: string | null
    supabase: SupabaseClient<Database>
}

export function toOrganizationRole(value: string): OrganizationRole {
    return value === 'owner' ? 'owner' : 'admin'
}

export function readOrganization(supabase: SupabaseClient<Database>, organizationId: string) {
    return selectMaybeSingle(supabase, 'organizations', ORGANIZATION_COLUMNS, { id: organizationId })
}

// The organization of the console: the one whose host is being visited, else the caller's earliest.
// Read with the token's identity alone: what the caller does here does not depend on the workspace
// they have open, which may be one of their clients' or one just deleted.
export async function requireOrganizationContext(min: OrganizationRole = 'admin'): Promise<OrganizationContext> {
    if (!ORGANIZATIONS_ENABLED) throw new AuthorizationError()
    const identity = await getSessionIdentity()
    if (!identity || identity.is_anonymous) throw new UnauthenticatedError()

    const supabase = createServiceRoleClient()
    const { organizationId } = await getBrand()
    const { data: memberships, error } = await selectMany(
        supabase,
        'organization_members',
        ['organization_id', 'role'] as const,
        { user_id: identity.id, ...(organizationId ? { organization_id: organizationId } : {}) },
        { column: 'created_at' },
        1,
    )
    if (error) throw new Error(error.message)
    const membership = memberships?.[0]
    if (!membership) throw new AuthorizationError()

    const { data: organization } = await readOrganization(supabase, membership.organization_id)
    if (!organization) throw new AuthorizationError()

    const role = toOrganizationRole(membership.role)
    if (min === 'owner' && role !== 'owner') throw new AuthorizationError('organizationOwnerOnly')
    return { organization, role, userId: identity.id, userEmail: realEmail(identity.email), supabase }
}

// For anything that changes something: a suspended organization reads its console and no more.
export async function requireActiveOrganization(min: OrganizationRole = 'admin'): Promise<OrganizationContext> {
    const ctx = await requireOrganizationContext(min)
    if (ctx.organization.status !== 'active') throw new AuthorizationError('organizationSuspended')
    return ctx
}

const WORKSPACE_COLUMNS = ['id', 'name', 'icon_url', 'locale', 'max_seats', 'created_at', 'last_active_at', 'plan', 'subscription_status', 'organization_id', 'organization_archived_at', 'boxes_archived_at', 'boxes_disabled_at', 'stripe_customer_id', 'rerun_budget_micros', 'rerun_used_micros', 'rerun_topup_micros', 'rerun_period_anchor'] as const

export type OrganizationWorkspaceRow = Pick<Database['public']['Tables']['workspaces']['Row'], (typeof WORKSPACE_COLUMNS)[number]>

// Another organization's workspace answers like one that does not exist.
export async function requireOrganizationWorkspace(ctx: OrganizationContext, workspaceId: number): Promise<OrganizationWorkspaceRow> {
    const { data, error } = await selectMaybeSingle(ctx.supabase, 'workspaces', WORKSPACE_COLUMNS, { id: workspaceId, organization_id: ctx.organization.id })
    if (error) throw new Error(error.message)
    if (!data) throw new AuthorizationError('workspaceNotFound')
    return data
}

export async function readOrganizationWorkspaces(ctx: OrganizationContext): Promise<OrganizationWorkspaceRow[]> {
    const { data, error } = await selectMany(ctx.supabase, 'workspaces', WORKSPACE_COLUMNS, { organization_id: ctx.organization.id }, { column: 'created_at' })
    if (error) throw new Error(error.message)
    return data ?? []
}
