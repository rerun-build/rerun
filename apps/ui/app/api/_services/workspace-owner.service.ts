import { earliestAdminFirst } from '@/app/api/_auth/ownership'
import { selectWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export type WorkspaceOwner = { userId: string; email: string }

// The owner's login email is the PostHog distinct_id (matches posthog.identify), so webhook-side
// events attach to the same person. Ignores email prefs — this is analytics identity, not a mailing.
export async function resolveWorkspaceOwner(workspaceId: number): Promise<WorkspaceOwner | null> {
    const supabase = createServiceRoleClient()
    const { data: members } = await selectWorkspaceMembers(supabase, ['user_id', 'role'] as const, { workspace_id: workspaceId })
    const owner = earliestAdminFirst(members ?? [])
    if (!owner) return null
    const { data } = await supabase.auth.admin.getUserById(owner.user_id)
    const email = data.user?.email
    return email ? { userId: owner.user_id, email } : null
}

// The member who started a run, when the engine names one, staff of an organization left out. Checked against the workspace so an
// engine cannot attribute its runs to someone outside it.
export async function resolveWorkspaceMemberEmail(workspaceId: number, userId: string): Promise<string | null> {
    const supabase = createServiceRoleClient()
    const { data: member } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, user_id: userId, organization_staff: false })
    if (!member) return null
    const { data } = await supabase.auth.admin.getUserById(member.user_id)
    return data.user?.email ?? null
}
