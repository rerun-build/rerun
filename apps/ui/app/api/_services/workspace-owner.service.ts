import { earliestAdminFirst } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

export type WorkspaceOwner = { userId: string; email: string }

export async function resolveWorkspaceOwner(workspaceId: number): Promise<WorkspaceOwner | null> {
    const supabase = createServiceRoleClient()
    const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id', 'role'] as const, { workspace_id: workspaceId }, { column: 'created_at' })
    const owner = earliestAdminFirst(members ?? [])
    if (!owner) return null
    const { data } = await supabase.auth.admin.getUserById(owner.user_id)
    const email = data.user?.email
    return email ? { userId: owner.user_id, email } : null
}

export async function resolveWorkspaceMemberEmail(workspaceId: number, userId: string): Promise<string | null> {
    const supabase = createServiceRoleClient()
    const { data: member } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, user_id: userId })
    if (!member) return null
    const { data } = await supabase.auth.admin.getUserById(member.user_id)
    return data.user?.email ?? null
}
