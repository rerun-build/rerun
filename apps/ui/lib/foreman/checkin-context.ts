import 'server-only'

import { toBoxScope } from '@/app/api/_auth/box-scope'
import { workspaceFounderUserId, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { realEmail } from '@/lib/auth/placeholder-email'
import { SESSION_WORKSPACE_COLUMNS } from '@/supabase/session/session-columns'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

// A check-in has nobody behind it: it reads the workspace as its founder sees it, the account an
// engine key already acts as everywhere else. Null when the workspace has nobody left to stand for it.
export async function founderContext(workspaceId: number): Promise<WorkspaceContext | null> {
    const founder = await workspaceFounderUserId(workspaceId)
    return founder ? memberContext(workspaceId, founder) : null
}

// The context a browser session would give this member, for a caller that has none (a check-in, an
// API key). Null when they are no longer a member, or their account is gone.
export async function memberContext(workspaceId: number, userId: string): Promise<WorkspaceContext | null> {
    const supabase = createServiceRoleClient()
    const [{ data: workspace }, { data: membership }, { data: user }, { data: auth }] = await Promise.all([
        selectMaybeSingle(supabase, 'workspaces', SESSION_WORKSPACE_COLUMNS, { id: workspaceId }),
        selectMaybeSingle(supabase, 'workspace_members', ['role', 'box_scope', 'organization_staff'] as const, { workspace_id: workspaceId, user_id: userId }),
        selectMaybeSingle(supabase, 'users', ['locale'] as const, { id: userId }),
        supabase.auth.admin.getUserById(userId),
    ])
    if (!workspace || !membership || !auth.user) return null
    return { userId, userEmail: realEmail(auth.user.email), userLocale: user?.locale ?? null, authUser: auth.user, workspace, role: membership.role, boxScope: toBoxScope(membership.box_scope), organizationStaff: membership.organization_staff, supabase }
}
