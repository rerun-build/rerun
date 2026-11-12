import { createClient, getRequestAccessToken, getRequestWorkspaceId } from '@/supabase/server'
import type { Enums } from '@/app/api/database.types'
import { cache } from 'react'
import { selectMaybeSingle, selectSingle } from '../supabase-helpers'

// The caller's user row and the workspace it acts in, nothing more: one RLS read, which only
// returns a row when PostgREST accepted the JWT. The guards that only need a workspace id stop
// here instead of paying for the workspace row and a round-trip to the auth server.
export const getSessionWorkspace = cache(async () => {
    const supabase = await createClient()
    const { data: storedUser } = await selectSingle(supabase, 'users', ['id', 'workspace_id', 'email_notification_prefs', 'locale'] as const, {})
    const requestedWorkspaceId = await getRequestWorkspaceId()

    // The workspace, named by the request or stored on the row, only stands once the caller's own
    // membership proves it: users.workspace_id was once client-writable, and a membership can be
    // revoked after the row was written. Refused, the session carries neither user nor workspace,
    // so every caller fails closed.
    let workspaceRefused = false
    let user = storedUser
    let membership: { role: Enums<'workspace_role'>; box_scope: string } | null = null
    if (storedUser) {
        const workspaceId = requestedWorkspaceId ?? storedUser.workspace_id
        const { data: row } = Number.isNaN(workspaceId)
            ? { data: null }
            : await selectMaybeSingle(supabase, 'workspace_members', ['workspace_id', 'role', 'box_scope'] as const, { user_id: storedUser.id, workspace_id: workspaceId })
        membership = row ? { role: row.role, box_scope: row.box_scope } : null
        workspaceRefused = !row
        user = row ? { ...storedUser, workspace_id: workspaceId } : null
    }

    return { supabase, user, workspaceRefused, membership }
})

export const getServerSession = cache(async () => {
    const { supabase, user, workspaceRefused } = await getSessionWorkspace()

    const [{ data: workspace }, { data: authUser }] = await Promise.all([
        !workspaceRefused
            ? selectSingle(supabase, 'workspaces', ['id', 'name', 'icon_url', 'plan', 'max_agents', 'max_seats', 'model_access', 'custom_integrations', 'subscription_status', 'current_period_end', 'trial_ends_at', 'is_sandbox', 'onboarded_at', 'price_arm', 'locale', 'billing_provider'] as const, { id: user?.workspace_id })
            : Promise.resolve({ data: null }),
        getRequestAccessToken().then(token => supabase.auth.getUser(token ?? undefined)),
    ])

    return { user, workspace, workspaceRefused, session: authUser?.user, isAnonymous: authUser?.user?.is_anonymous ?? false }
})
