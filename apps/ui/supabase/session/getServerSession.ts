import { createClient, getRequestAccessToken, getRequestWorkspaceId, isPageRequest } from '@/supabase/server'
import type { Database, Enums } from '@/app/api/database.types'
import { requestHostScope } from '@/lib/brand/host-scope'
import { LAST_WORKSPACE_COOKIE, opensOnHost, pickHostWorkspace, readWorkspaceId, type HostMembership, type HostScope } from '@/lib/workspace/host-workspace'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { selectMany, selectMaybeSingle, selectSingle } from '../supabase-helpers'
import { SESSION_USER_COLUMNS, SESSION_WORKSPACE_COLUMNS } from './session-columns'

// What the access token says about its bearer, checked against the project's signing key with no
// round-trip to the auth server. It is as fresh as the token: a name or an email changed since it
// was issued shows at the next refresh. What needs the account as the auth server holds it now (its
// identities, an email being changed) reads `getAuthUser`.
export type SessionIdentity = Pick<User, 'id' | 'email' | 'is_anonymous' | 'user_metadata' | 'app_metadata'>

type SessionBase = { supabase: SupabaseClient<Database>; identity: SessionIdentity | null; requestedWorkspaceId: number | null; scope: HostScope | null }

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
    const [supabase, token, requestedWorkspaceId, scope] = await Promise.all([createClient(), getRequestAccessToken(), getRequestWorkspaceId(), requestHostScope()])
    return { supabase, identity: await readSessionIdentity(supabase, token), requestedWorkspaceId, scope }
})

// Who is calling, from the token alone: no read of `users` nor of the workspace.
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
    return (await openSession()).identity
}

function readStoredUser(supabase: SupabaseClient<Database>) {
    return selectSingle(supabase, 'users', SESSION_USER_COLUMNS, {})
}

async function readMembership(supabase: SupabaseClient<Database>, userId: string, workspaceId: number) {
    if (Number.isNaN(workspaceId)) return null
    const { data } = await selectMaybeSingle(supabase, 'workspace_members', ['workspace_id', 'role', 'box_scope', 'organization_staff'] as const, { user_id: userId, workspace_id: workspaceId })
    return data
}

// The caller's workspaces and whose they are.
async function readHostMemberships(supabase: SupabaseClient<Database>, userId: string): Promise<HostMembership[]> {
    const { data: rows } = await selectMany(supabase, 'workspace_members', ['workspace_id', 'created_at'] as const, { user_id: userId })
    if (!rows?.length) return []
    const { data: workspaces } = await selectMany(supabase, 'workspaces', ['id', 'organization_id'] as const, { id: rows.map(row => row.workspace_id) })
    const organizations = new Map((workspaces ?? []).map(workspace => [workspace.id, workspace.organization_id]))
    return rows.flatMap(row => (organizations.has(row.workspace_id) ? [{ workspaceId: row.workspace_id, organizationId: organizations.get(row.workspace_id) ?? null, joinedAt: row.created_at }] : []))
}

async function lastWorkspaceHere(): Promise<number | null> {
    try {
        return readWorkspaceId((await cookies()).get(LAST_WORKSPACE_COOKIE)?.value)
    } catch {
        return null
    }
}

// The workspace a request that names none acts in: the stored one, unless the host it came in on opens
// others. An organization's address opens its own workspaces, whatever asks; a page of Rerun's address
// opens the ones no organization runs, and the calls that come there without a page (a phone, a
// provider coming back) go on as they always have. Null when the host opens none of theirs.
async function unnamedWorkspaceOf({ supabase, scope }: SessionBase, stored: { id: string; workspace_id: number }): Promise<number | null> {
    if (!scope) return stored.workspace_id
    if (scope.organizationId) return pickHostWorkspace(scope, await readHostMemberships(supabase, stored.id), [stored.workspace_id, await lastWorkspaceHere()])
    if (!(await isPageRequest())) return stored.workspace_id
    return pickHostWorkspace(scope, await readHostMemberships(supabase, stored.id), [stored.workspace_id]) ?? stored.workspace_id
}

// A workspace a request names opens on an organization's address only if it is that organization's. It
// is refused rather than replaced: what was meant for one workspace is never done in another.
async function namedOpensHere({ supabase, scope }: SessionBase, workspaceId: number): Promise<boolean> {
    if (!scope?.organizationId || Number.isNaN(workspaceId)) return true
    const { data } = await selectMaybeSingle(supabase, 'workspaces', ['organization_id'] as const, { id: workspaceId })
    return opensOnHost(scope, data?.organization_id ?? null)
}

// Keyed on the session it reads for, so a render shares one read between everything that asks, and
// a caller holding the session hands it over instead of opening a second one.
const sessionWorkspaceOf = cache(async (base: SessionBase) => {
    const { supabase, identity, requestedWorkspaceId } = base
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
    let membership: { role: Enums<'workspace_role'>; box_scope: string; organization_staff: boolean } | null = null
    if (storedUser) {
        const opened = requestedWorkspaceId ?? (await unnamedWorkspaceOf(base, storedUser))
        const workspaceId = opened ?? storedUser.workspace_id
        const here = opened !== null && (requestedWorkspaceId === null || (await namedOpensHere(base, requestedWorkspaceId)))
        const row = !here ? null : named && identity?.id === storedUser.id ? await named : await readMembership(supabase, storedUser.id, workspaceId)
        membership = row ? { role: row.role, box_scope: row.box_scope, organization_staff: row.organization_staff } : null
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
    const readWorkspace = (id: number) => selectSingle(supabase, 'workspaces', SESSION_WORKSPACE_COLUMNS, { id })

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
