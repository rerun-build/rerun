import { createServiceRoleClient } from '@/supabase/serviceRole'

// A real session reads the caller's membership under RLS and carries it. A test that says who the
// caller is with the rows of its fake database gets the same from here: the session its mocked
// getServerSession answers, completed with the membership row that database holds.
export function sessionWithMembership<S extends { user: { id: string; workspace_id: number } }>(session: S) {
    return async () => {
        const { data } = await createServiceRoleClient().from('workspace_members').select('role, box_scope').eq('user_id', session.user.id).eq('workspace_id', session.user.workspace_id).maybeSingle()
        return { ...session, membership: data ?? null }
    }
}
