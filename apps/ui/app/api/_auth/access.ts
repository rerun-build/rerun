import { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'
import type { ErrorCode } from '@/lib/i18n/action-error'
import { toBoxScope, type BoxScope } from '@/app/api/_auth/box-scope'
import type { WorkspaceContext, WorkspaceRole } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getSessionWorkspace } from '@/supabase/session/getServerSession'
import { selectAll, selectMany, selectMaybeSingle, selectMaybeSingleWithJoins } from '@/supabase/supabase-helpers'

// Access by Box. A person reaches a Box, and therefore every coworker in it, or does not; a coworker
// carries no access of its own. This file is the server's copy of the rule; the database holds the
// same one in `visible_space_ids()` / `manageable_space_ids()` for RLS, and the board store a third
// for the buttons. All three must answer the same thing.
//
//   admin                                    -> manage
//   a `space_members` row                    -> its level (use | manage)
//   scope `all` and the Box open to everyone -> use
//   otherwise                                -> none

export type BoxAccess = 'none' | 'use' | 'manage'
export type AccessLevel = 'use' | 'manage'
export type SpaceVisibility = 'workspace' | 'restricted'

// Who is asking. A person signed in, or the workspace itself: an API key, the onboarding, a foreman
// turn with no person behind it. The workspace stands for its admins, so it reaches every Box.
export type Actor = { kind: 'user'; userId: string; workspaceId: number; role: WorkspaceRole; boxScope: BoxScope } | { kind: 'workspace'; workspaceId: number }

export const BOX_MANAGE_ONLY = 'boxManagerOnly' satisfies ErrorCode
export const COWORKER_NOT_FOUND = 'coworkerNotFound' satisfies ErrorCode
export const BOX_NOT_FOUND = 'boxNotFound' satisfies ErrorCode

// Reached the resource but may not do this to it. The v1 API answers it with a 403, where any other
// AuthorizationError past authentication reads as a 404.
export class AccessDeniedError extends AuthorizationError {
    constructor(code: ErrorCode = BOX_MANAGE_ONLY) {
        super(code)
        this.name = 'AccessDeniedError'
    }
}

// For an action that answers with a result rather than a throw: which refusal it folded in, so the
// v1 route hands back the 403 or 404 a thrown one would have. Nothing for any other error.
export type DeniedCode = 'forbidden' | 'not_found'

export function deniedCode(err: unknown): DeniedCode | undefined {
    if (err instanceof AccessDeniedError) return 'forbidden'
    if (err instanceof AuthorizationError && !(err instanceof UnauthenticatedError)) return 'not_found'
    return undefined
}

export function toVisibility(value: string | null | undefined): SpaceVisibility {
    return value === 'restricted' ? 'restricted' : 'workspace'
}

export function toAccessLevel(value: string | null | undefined): AccessLevel | null {
    return value === 'manage' || value === 'use' ? value : null
}

export function workspaceActor(workspaceId: number): Actor {
    return { kind: 'workspace', workspaceId }
}

export function actorFromContext(ctx: Pick<WorkspaceContext, 'userId' | 'role' | 'boxScope'> & { workspace: { id: number } }): Actor {
    return { kind: 'user', userId: ctx.userId, workspaceId: ctx.workspace.id, role: ctx.role, boxScope: ctx.boxScope }
}

export function isAdminActor(actor: Actor): boolean {
    return actor.kind === 'workspace' || actor.role === 'admin'
}

// The signed-in caller as an actor, in a single read: the membership row the session already proves.
export async function requireLightSessionActor(): Promise<Actor> {
    const { user, workspaceRefused, membership } = await getSessionWorkspace()
    if (workspaceRefused) throw new AuthorizationError('notMember')
    if (!user?.id || !user.workspace_id || !membership) throw new UnauthenticatedError()
    return { kind: 'user', userId: user.id, workspaceId: user.workspace_id, role: membership.role, boxScope: toBoxScope(membership.box_scope) }
}

// The rule itself, with every input already read. Pure, so the matrix is tested without a database.
export function boxAccessOf(actor: Actor, space: { workspace_id: number; visibility: string | null }, grant: AccessLevel | null): BoxAccess {
    if (space.workspace_id !== actor.workspaceId) return 'none'
    if (isAdminActor(actor)) return 'manage'
    if (grant) return grant
    if (actor.kind === 'user' && actor.boxScope === 'all' && toVisibility(space.visibility) === 'workspace') return 'use'
    return 'none'
}

export function hasAccess(have: BoxAccess, need: AccessLevel): boolean {
    if (need === 'use') return have === 'use' || have === 'manage'
    return have === 'manage'
}

async function grantOf(actor: Actor, spaceId: string): Promise<AccessLevel | null> {
    if (actor.kind !== 'user' || actor.role === 'admin') return null
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'space_members', ['access'] as const, { space_id: spaceId, user_id: actor.userId })
    return toAccessLevel(data?.access)
}

export async function spaceAccessFor(actor: Actor, space: { id: string; workspace_id: number; visibility: string | null }): Promise<BoxAccess> {
    if (space.workspace_id !== actor.workspaceId) return 'none'
    return boxAccessOf(actor, space, await grantOf(actor, space.id))
}

export async function readSpaceAccess(actor: Actor, spaceId: string): Promise<BoxAccess> {
    const { data: space } = await selectMaybeSingle(createServiceRoleClient(), 'spaces', ['id', 'workspace_id', 'visibility'] as const, { id: spaceId })
    if (!space) return 'none'
    return spaceAccessFor(actor, space)
}

// Throws the way the caller expects: a Box the actor cannot see does not exist, a Box it only uses
// refuses the change with a reason it can show.
export function enforce(have: BoxAccess, need: AccessLevel, notFound: ErrorCode): void {
    if (have === 'none') throw new AuthorizationError(notFound)
    if (!hasAccess(have, need)) throw new AccessDeniedError()
}

export async function assertSpaceAccess(spaceId: string, need: AccessLevel, actor?: Actor): Promise<{ actor: Actor; access: BoxAccess }> {
    const resolved = actor ?? (await requireLightSessionActor())
    const access = await readSpaceAccess(resolved, spaceId)
    enforce(access, need, BOX_NOT_FOUND)
    return { actor: resolved, access }
}

export async function assertAgentAccess(agentId: string, need: AccessLevel, actor?: Actor): Promise<{ actor: Actor; access: BoxAccess; agent: { workspace_id: number; space_id: string; engine_agent_id: string | null } }> {
    const resolved = actor ?? (await requireLightSessionActor())
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['workspace_id', 'space_id', 'engine_agent_id'] as const, { id: agentId })
    if (!agent || agent.workspace_id !== resolved.workspaceId) throw new AuthorizationError(COWORKER_NOT_FOUND)
    const access = await readSpaceAccess(resolved, agent.space_id)
    enforce(access, need, COWORKER_NOT_FOUND)
    return { actor: resolved, access, agent }
}

// Every Box of the workspace with the actor's level on it, in two reads. The lists and the board use
// it; a single Box goes through spaceAccessFor.
export async function spaceAccessMap(actor: Actor): Promise<Map<string, BoxAccess>> {
    const supabase = createServiceRoleClient()
    const grantsRead = actor.kind === 'user' && actor.role !== 'admin' ? selectMany(supabase, 'space_members', ['space_id', 'access'] as const, { user_id: actor.userId, workspace_id: actor.workspaceId }) : Promise.resolve({ data: [] })
    const [{ data: spaces }, { data: grants }] = await Promise.all([selectAll(supabase, 'spaces', ['id', 'workspace_id', 'visibility'] as const, { workspace_id: actor.workspaceId }), grantsRead])
    const grantBySpace = new Map((grants ?? []).map(row => [row.space_id, toAccessLevel(row.access)]))
    return new Map((spaces ?? []).map(space => [space.id, boxAccessOf(actor, space, grantBySpace.get(space.id) ?? null)]))
}

// 'all' when nothing needs filtering (an admin, or the workspace), otherwise the ids.
export async function visibleSpaceIds(actor: Actor): Promise<'all' | Set<string>> {
    if (isAdminActor(actor)) return 'all'
    const map = await spaceAccessMap(actor)
    return new Set([...map].filter(([, access]) => access !== 'none').map(([id]) => id))
}

export async function manageableSpaceIds(actor: Actor): Promise<'all' | Set<string>> {
    if (isAdminActor(actor)) return 'all'
    const map = await spaceAccessMap(actor)
    return new Set([...map].filter(([, access]) => access === 'manage').map(([id]) => id))
}

export async function visibleAgentIds(actor: Actor): Promise<'all' | Set<string>> {
    const spaces = await visibleSpaceIds(actor)
    if (spaces === 'all') return 'all'
    if (spaces.size === 0) return new Set()
    const { data: agents } = await selectAll(createServiceRoleClient(), 'agents', ['id'] as const, { workspace_id: actor.workspaceId, space_id: [...spaces] })
    return new Set((agents ?? []).map(agent => agent.id))
}

// For a run started in someone's name: the engine ids of the coworkers they reach, which the engine
// narrows `call_agent` to. Undefined when they reach every Box, so the engine offers the whole
// machine as before.
export async function callableEngineAgentIds(actor: Actor): Promise<string[] | undefined> {
    if (isAdminActor(actor)) return undefined
    const map = await spaceAccessMap(actor)
    const visible = [...map].filter(([, access]) => access !== 'none').map(([id]) => id)
    if (visible.length === map.size) return undefined
    if (visible.length === 0) return []
    const { data: agents } = await selectAll(createServiceRoleClient(), 'agents', ['engine_agent_id'] as const, { workspace_id: actor.workspaceId, space_id: visible })
    return (agents ?? []).flatMap(agent => (agent.engine_agent_id ? [agent.engine_agent_id] : []))
}

export function keepVisible<T>(rows: T[], visible: 'all' | Set<string>, idOf: (row: T) => string | null | undefined): T[] {
    if (visible === 'all') return rows
    return rows.filter(row => {
        const id = idOf(row)
        return !!id && visible.has(id)
    })
}

// Asserts the caller reaches the agent at the level asked. Returns the row so callers don't fetch it
// twice. Replaces the workspace-only check: reaching the workspace no longer means reaching the Box.
export async function assertAgentInWorkspace(agentId: string, need: AccessLevel = 'use', actor?: Actor): Promise<{ workspace_id: number; space_id: string; engine_agent_id: string | null }> {
    return (await assertAgentAccess(agentId, need, actor)).agent
}

// For an OAuth callback, which lands in a popup that names no workspace: the agent names its own,
// held to the caller's membership like a workspace a tab names. Connecting an app to a coworker
// changes what it is, so it takes `manage` on its Box.
export async function requireAgentWorkspaceId(agentId: string, need: AccessLevel = 'manage'): Promise<number> {
    const { user } = await getSessionWorkspace()
    if (!user?.id) throw new UnauthenticatedError()
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['workspace_id'] as const, { id: agentId })
    if (!agent) throw new AuthorizationError(COWORKER_NOT_FOUND)
    const { data: membership } = await selectMaybeSingle(supabase, 'workspace_members', ['role', 'box_scope'] as const, { user_id: user.id, workspace_id: agent.workspace_id })
    if (!membership) throw new AuthorizationError(COWORKER_NOT_FOUND)
    await assertAgentAccess(agentId, need, { kind: 'user', userId: user.id, workspaceId: agent.workspace_id, role: membership.role, boxScope: toBoxScope(membership.box_scope) })
    return agent.workspace_id
}

type OwnedSession = { id: string; agent_id: string; engine_session_id: string | null; engine_agent_id: string | null }

// Asserts a session belongs to an agent the caller can use (session -> agent -> Box), mirroring the
// RLS policy on sessions. The session, its agent and its Box come back in one read. `actor` is
// passed in by a caller that already started resolving it.
export async function assertSessionInWorkspace(sessionId: string, actor?: Promise<Actor> | Actor): Promise<OwnedSession> {
    const [callerActor, session] = await Promise.all([actor ?? requireLightSessionActor(), readSessionWithAgent(sessionId)])
    if (!session?.agent || session.agent.workspace_id !== callerActor.workspaceId) throw new AuthorizationError('sessionNotFound')
    if (!hasAccess(await readSpaceAccess(callerActor, session.agent.space_id), 'use')) throw new AuthorizationError('sessionNotFound')
    return { id: session.id, agent_id: session.agent_id, engine_session_id: session.engine_session_id, engine_agent_id: session.agent.engine_agent_id }
}

async function readSessionWithAgent(sessionId: string) {
    const { data } = await selectMaybeSingleWithJoins(
        createServiceRoleClient(),
        'sessions',
        ['id', 'agent_id', 'engine_session_id'] as const,
        // Named, because origin_agent_id points at agents too.
        { agent: { table: 'agents', foreignKey: 'agents!sessions_agent_id_fkey', columns: ['workspace_id', 'space_id', 'engine_agent_id'] } } as const,
        { id: sessionId },
    )
    return data
}

// A member named by something the hub signed (a foreman turn's token), held to their membership
// as it stands now: someone who left since the token was minted reaches nothing.
export async function memberActor(workspaceId: number, userId: string): Promise<Actor | null> {
    const { data: membership } = await selectMaybeSingle(createServiceRoleClient(), 'workspace_members', ['role', 'box_scope'] as const, { user_id: userId, workspace_id: workspaceId })
    if (!membership) return null
    return { kind: 'user', userId, workspaceId, role: membership.role, boxScope: toBoxScope(membership.box_scope) }
}
