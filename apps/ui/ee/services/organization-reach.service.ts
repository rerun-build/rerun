// No 'server-only': the proxy asks, on every page of an organization's own domain.
import type { Database } from '@/app/api/database.types'
import { keeper } from '@/ee/lib/organizations/keeper'
import { BASE_PLAN_SLUG } from '@/ee/lib/billing/plans'
import { organizationDefaultUrl } from '@/ee/services/organization-brand.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectCount, selectMany } from '@/supabase/supabase-helpers'
import type { Brand } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

type Client = SupabaseClient<Database>

const WORKSPACE_COLUMNS = ['id', 'organization_id', 'plan', 'subscription_status', 'rerun_topup_micros'] as const
type WorkspaceRow = Pick<Database['public']['Tables']['workspaces']['Row'], (typeof WORKSPACE_COLUMNS)[number]>

// A workspace of Rerun's that only exists because an account has to have one (the one opened for an
// organization's team, or for a client it let go) holds nothing: no plan, no credit, no coworker.
const holdsNothingYet = (workspace: WorkspaceRow): boolean => workspace.plan === BASE_PLAN_SLUG && workspace.subscription_status === null && workspace.rerun_topup_micros === 0

async function readReach(key: string): Promise<boolean> {
    const [userId, organizationId] = key.split(' ')
    const supabase: Client = createServiceRoleClient()
    const { data: memberships, error } = await selectAll(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId })
    if (error) throw new Error(error.message)
    if (memberships.length === 0) return false

    const { data: workspaces, error: workspacesError } = await selectMany(supabase, 'workspaces', WORKSPACE_COLUMNS, { id: memberships.map(row => row.workspace_id) })
    if (workspacesError) throw new Error(workspacesError.message)
    const elsewhere = (workspaces ?? []).filter(workspace => workspace.organization_id !== organizationId)
    if (elsewhere.some(workspace => workspace.organization_id !== null || !holdsNothingYet(workspace))) return true
    if (elsewhere.length === 0) return false

    const { data: coworkers, error: coworkersError } = await selectCount(supabase, 'agents', { workspace_id: elsewhere.map(workspace => workspace.id), kind: 'coworker' })
    if (coworkersError) throw new Error(coworkersError.message)
    return (coworkers ?? 0) > 0
}

const reaches = keeper(readReach)

// Whether an account works somewhere this organization has no say: another organization's workspace,
// or one of Rerun's that is in use. Its session is the same everywhere, so it is never left on a domain
// whose DNS the organization holds: that account signs in on the address Rerun answers for.
export async function reachesBeyondOrganization(userId: string, organizationId: string): Promise<boolean> {
    return reaches.get(`${userId} ${organizationId}`)
}

// Where an account opens the organization's app: the address its brand names, unless the account also
// works elsewhere, which is never signed in on a domain of the organization's own.
export async function brandReachedBy(userId: string, organizationId: string, brand: Brand): Promise<Brand> {
    if (!(await reachesBeyondOrganization(userId, organizationId))) return brand
    return { ...brand, appUrl: (await organizationDefaultUrl(organizationId)) ?? brand.appUrl }
}
