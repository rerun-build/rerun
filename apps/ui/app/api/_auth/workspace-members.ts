import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { selectAll, selectCount, type Filters, type TableRow } from '@/supabase/supabase-helpers'

// Who is in a workspace, as its own people see it: oldest first, without the team of the organization
// that runs it. Anything that lists, counts, notifies or mentions members reads them here. Checking
// one person's own membership reads the row itself: staff are full members of their session.
type MemberFilters = Omit<Filters<'workspace_members'>, 'organization_staff'>

export function selectWorkspaceMembers<K extends keyof TableRow<'workspace_members'>, S extends readonly K[]>(supabase: SupabaseClient<Database>, columns: S, filters: MemberFilters) {
    return selectAll<'workspace_members', K, S>(supabase, 'workspace_members', columns, { ...filters, organization_staff: false }, { column: 'created_at', ascending: true })
}

export function countWorkspaceMembers(supabase: SupabaseClient<Database>, filters: MemberFilters) {
    return selectCount(supabase, 'workspace_members', { ...filters, organization_staff: false })
}

// Those of `userIds` who are in the workspace for the organization that runs it.
export async function organizationStaffAmong(supabase: SupabaseClient<Database>, workspaceId: number, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set()
    const { data, error } = await selectAll(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, user_id: userIds, organization_staff: true })
    if (error) throw new Error(error.message)
    return new Set(data.map(row => row.user_id))
}

export async function earliestOrganizationStaff(supabase: SupabaseClient<Database>, workspaceId: number): Promise<string | null> {
    const { data } = await selectAll(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, organization_staff: true }, { column: 'created_at', ascending: true })
    return data?.[0]?.user_id ?? null
}
