import { createClient, getRequestAccessToken, getRequestWorkspaceId } from '@/supabase/server'
import type { Database, Enums } from '@/app/api/database.types'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { cache } from 'react'
import { selectMaybeSingle, selectSingle } from '../supabase-helpers'

// What the access token says about its bearer, checked against the project's signing key with no
// round-trip to the auth server. It is as fresh as the token: a name or an email changed since it
// was issued shows at the next refresh. What needs the account as the auth server holds it now (its
// identities, an email being changed) reads `getAuthUser`.
export type SessionIdentity = Pick<User, 'id' | 'email' | 'is_anonymous' | 'user_metadata' | 'app_metadata'>

type SessionBase = { supabase: SupabaseClient<Database>; identity: SessionIdentity | null; requestedWorkspaceId: number | null }

const WORKSPACE_COLUMNS = ['id', 'name', 'icon_url', 'plan', 'max_agents', 'max_seats', 'model_access', 'custom_integrations', 'subscription_status', 'current_period_end', 'trial_ends_at', 'is_sandbox', 'onboarded_at', 'price_arm', 'locale'] as const

// A bearer client keeps no session, so the token is handed over; a cookie client reads its own.
async function readSessionIdentity(supabase: SupabaseClient<Database>, token: string | null): Promise<SessionIdentity | null> {
    try {
        const { data } = await supabase.auth.getClaims(token ?? undefined)
        const claims = data?.claims
        if (!claims?.sub) return null
        return { id: claims.sub, email: claims.email, is_anonymous: claims.is_anonymous, user_metadata: claims.user_metadata ?? {}, app_metadata: claims.app_metadata ?? {} }
    } catch {
        return null
    }
}

const openSession = cache(async (): Promise<SessionBase> => {
    const [supabase, token, requestedWorkspaceId] = await Promise.all([createClient(), getRequestAccessToken(), getRequestWorkspaceId()])
    return { supabase, identity: await readSessionIdentity(supabase, token), requestedWorkspaceId }
})

function readStoredUser(supabase: SupabaseClient<Database>) {
    return selectSingle(supabase, 'users', ['id', 'workspace_id', 'email_notification_prefs', 'locale'] as const, {})
}

async function readMembership(supabase: SupabaseClient<Database>, userId: string, workspaceId: number) {
    if (Number.isNaN(workspaceId)) return null
    const { data } = await selectMaybeSingle(supabase, 'workspace_members', ['workspace_id', 'role', 'box_scope'] as const, { user_id: userId, workspace_id: workspaceId })
    return data
}

// Keyed on the session it reads for, so a render shares one read between everything that asks, and
// a caller holding the session hands it over instead of opening a second one.
const sessionWorkspaceOf = cache(async ({ supabase, identity, requestedWorkspaceId }: SessionBase) => {
    // A request that names its workspace under a verified token has said everything both reads
    // need, so they leave together. Otherwise the membership waits for the row that names the
    // workspace. Either way both go through RLS, which only answers a JWT PostgREST accepted.
    const named = identity && requestedWorkspaceId !== null ? readMembership(supabase, identity.id, requestedWorkspaceId) : null
    const { data: storedUser } = await readStoredUser(supabase)

    // The workspace, named by the request or stored on the row, only stands once the caller's own
    // membership proves it: users.workspace_id was once client-writable, and a membership can be
    // revoked after the row was written. Refused, the session carries neither user nor workspace,
    // so every caller fails closed.
    let workspaceRefused = false
    let user = storedUser
    let membership: { role: Enums<'workspace_role'>; box_scope: string } | null = null
    if (storedUser) {
        const workspaceId = requestedWorkspaceId ?? storedUser.workspace_id
        const row = named && identity?.id === storedUser.id ? await named : await readMembership(supabase, storedUser.id, workspaceId)
        membership = row ? { role: row.role, box_scope: row.box_scope } : null
        workspaceRefused = !row
        user = row ? { ...storedUser, workspace_id: workspaceId } : null
    }

    return { supabase, user, workspaceRefused, membership }
})

// The caller's user row and the workspace it acts in, nothing more. The guards that only need a
// workspace id stop here instead of paying for the workspace row.
export async function getSessionWorkspace() {
    return sessionWorkspaceOf(await openSession())
}

export const getServerSession = cache(async () => {
    const base = await openSession()
    const { supabase, identity, requestedWorkspaceId } = base
    const readWorkspace = (id: number) => selectSingle(supabase, 'workspaces', WORKSPACE_COLUMNS, { id })

    // The workspace row of a named workspace is asked for alongside the membership that will
    // confirm it, and dropped when that membership refuses.
    const named = identity && requestedWorkspaceId !== null && !Number.isNaN(requestedWorkspaceId) ? readWorkspace(requestedWorkspaceId) : null
    const { user, workspaceRefused, membership } = await sessionWorkspaceOf(base)

    const { data: workspace } = !user ? { data: null } : await (named ?? readWorkspace(user.workspace_id))

    return { user, workspace, workspaceRefused, membership, session: identity }
})

// The account as the auth server holds it now, for what a token cannot say or says too late.
export async function getAuthUser(): Promise<User | null> {
    const [supabase, token] = await Promise.all([createClient(), getRequestAccessToken()])
    const { data } = await supabase.auth.getUser(token ?? undefined)
    return data.user
}
