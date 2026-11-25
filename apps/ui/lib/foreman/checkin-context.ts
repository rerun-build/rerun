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
    const supabase = createServiceRoleClient()
    const founder = await workspaceFounderUserId(workspaceId)
    if (!founder) return null
    const [{ data: workspace }, { data: membership }, { data: user }, { data: auth }] = await Promise.all([
        selectMaybeSingle(supabase, 'workspaces', SESSION_WORKSPACE_COLUMNS, { id: workspaceId }),
        selectMaybeSingle(supabase, 'workspace_members', ['role', 'box_scope', 'organization_staff'] as const, { workspace_id: workspaceId, user_id: founder }),
        selectMaybeSingle(supabase, 'users', ['locale'] as const, { id: founder }),
        supabase.auth.admin.getUserById(founder),
    ])
    if (!workspace || !membership || !auth.user) return null
    return { userId: founder, userEmail: realEmail(auth.user.email), userLocale: user?.locale ?? null, authUser: auth.user, workspace, role: membership.role, boxScope: toBoxScope(membership.box_scope), organizationStaff: membership.organization_staff, supabase }
}
