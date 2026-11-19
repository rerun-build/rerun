import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { isSubscriptionEntitled } from '@moldwright/cloud/billing'
import { selectMany } from '@/supabase/supabase-helpers'
import { toBoxScope } from '@/app/api/_auth/box-scope'
import type { WorkspaceSummary } from '@moldwright/contracts'

type Client = SupabaseClient<Database>

export async function listUserWorkspaces(supabase: Client, userId: string): Promise<WorkspaceSummary[]> {
    const { data: memberships, error: membershipsError } = await selectMany(supabase, 'workspace_members', ['workspace_id', 'role', 'box_scope'] as const, { user_id: userId })
    if (membershipsError) throw membershipsError
    const roles = new Map((memberships ?? []).map(m => [m.workspace_id, m.role]))
    const scopes = new Map((memberships ?? []).map(m => [m.workspace_id, toBoxScope(m.box_scope)]))
    const ids = [...roles.keys()]
    if (ids.length === 0) return []

    const { data: workspaces, error } = await selectMany(supabase, 'workspaces', ['id', 'name', 'icon_url', 'plan', 'is_sandbox', 'subscription_status'] as const, { id: ids })
    if (error) throw error
    return (workspaces ?? [])
        .filter(w => !w.is_sandbox)
        .sort((a, b) => a.id - b.id)
        .map(w => ({ id: w.id, name: w.name, iconUrl: w.icon_url, plan: w.plan, subscribed: isSubscriptionEntitled(w.subscription_status), role: roles.get(w.id) ?? 'member', boxScope: scopes.get(w.id) ?? 'all' }))
}
