import { FOREMAN_AGENT_ID, ORGANIZATION_AUTHOR_ID, agentKindPolicy, type AgentKind } from '@rerun/contracts'

import { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'
import type { ErrorCode } from '@/lib/i18n/action-error'
import { toBoxScope, type BoxScope } from '@/app/api/_auth/box-scope'
import type { WorkspaceContext, WorkspaceRole } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getSessionWorkspace } from '@/supabase/session/getServerSession'
import { ensureForemanAgentRow } from '@/lib/foreman/agent-row'
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
export type UserActor = { kind: 'user'; userId: string; workspaceId: number; role: WorkspaceRole; boxScope: BoxScope; organizationStaff?: boolean }
export type Actor = UserActor | { kind: 'workspace'; workspaceId: number }

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

export function actorFromContext(ctx: Pick<WorkspaceContext, 'userId' | 'role' | 'boxScope' | 'organizationStaff'> & { workspace: { id: number } }): UserActor {
    return { kind: 'user', userId: ctx.userId, workspaceId: ctx.workspace.id, role: ctx.role, boxScope: ctx.boxScope, organizationStaff: ctx.organizationStaff }
}

export function signedInUserId(actor: Actor): string {
    if (actor.kind !== 'user') throw new UnauthenticatedError()
    return actor.userId
}

// Who the machine of the workspace is told did something: what it stores is read by its coworkers and
// by its members, who know no one in the team of their organization.
export function signerIdOf(actor: Actor): string | null {
    if (actor.kind !== 'user') return null
    return actor.organizationStaff ? ORGANIZATION_AUTHOR_ID : actor.userId
}

export function isAdminActor(actor: Actor): boolean {
    return actor.kind === 'workspace' || actor.role === 'admin'
}

// The signed-in caller as an actor, in a single read: the membership row the session already proves.
export async function requireLightSessionActor(): Promise<UserActor> {
    const { user, workspaceRefused, membership } = await getSessionWorkspace()
    if (workspaceRefused) throw new AuthorizationError('notMember')
    if (!user?.id || !user.workspace_id || !membership) throw new UnauthenticatedError()
    return { kind: 'user', userId: user.id, workspaceId: user.workspace_id, role: membership.role, boxScope: toBoxScope(membership.box_scope), organizationStaff: membership.organization_staff }
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

// A row with no Box (the Chief of Staff) is reached through its own rule, never through this one.
export async function readSpaceAccess(actor: Actor, spaceId: string | null): Promise<BoxAccess> {
    if (!spaceId) return 'none'
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

// `foreman` names the Chief of Staff of the caller's workspace: the apps and the engine call it by
// that name, its row differs from one workspace to the next.
export async function agentRowIdOf(agentId: string, workspaceId: number): Promise<string> {
    return agentId === FOREMAN_AGENT_ID ? ensureForemanAgentRow(createServiceRoleClient(), workspaceId) : agentId
}

// The Chief of Staff sits in no Box: every member uses it, and the one level that manages every Box,
// an admin or the workspace itself, manages it.
function workspaceReachOf(actor: Actor): BoxAccess {
    return isAdminActor(actor) ? 'manage' : 'use'
}

export type AgentAccessRow = { workspace_id: number; kind: AgentKind; space_id: string | null; space?: { visibility: string | null } | null }

// The level the actor has on a coworker, by the rule of its kind: its Box, or the workspace.
export async function agentAccessFor(actor: Actor, agent: AgentAccessRow): Promise<BoxAccess> {
    if (agent.workspace_id !== actor.workspaceId) return 'none'
    if (agentKindPolicy(agent.kind).reach === 'workspace') return workspaceReachOf(actor)
    if (!agent.space_id) return 'none'
    if (agent.space) return spaceAccessFor(actor, { id: agent.space_id, workspace_id: agent.workspace_id, visibility: agent.space.visibility })
    return readSpaceAccess(actor, agent.space_id)
}

export type AccessedAgent = { id: string; workspace_id: number; kind: AgentKind; space_id: string | null; engine_agent_id: string | null }

export async function assertAgentAccess(agentId: string, need: AccessLevel, actor?: Actor): Promise<{ actor: Actor; access: BoxAccess; agent: AccessedAgent }> {
    const resolved = actor ?? (await requireLightSessionActor())
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['id', 'workspace_id', 'kind', 'space_id', 'engine_agent_id'] as const, { id: await agentRowIdOf(agentId, resolved.workspaceId) })
    if (!agent || agent.workspace_id !== resolved.workspaceId) throw new AuthorizationError(COWORKER_NOT_FOUND)
    const access = await agentAccessFor(resolved, agent)
    enforce(access, need, COWORKER_NOT_FOUND)
    return { actor: resolved, access, agent }
}

// The runs of a coworker whose conversations are each member's own reach only the member whose
// conversation they ran in: no other member, no API key, no coworker. The engine knows a run by its
// session alone, so a run is in reach when its session is one of the caller's rows.
export async function runSessionsInReach(agentId: string, engineSessionIds: string[], actor?: Actor): Promise<{ actor: Actor; agent: AccessedAgent; inReach: (engineSessionId: string) => boolean }> {
    const { actor: resolved, agent } = await assertAgentAccess(agentId, 'use', actor)
    if (agentKindPolicy(agent.kind).conversations !== 'per-member') return { actor: resolved, agent, inReach: () => true }
    const wanted = [...new Set(engineSessionIds)]
    if (resolved.kind !== 'user' || wanted.length === 0) return { actor: resolved, agent, inReach: () => false }
    const { data } = await selectMany(createServiceRoleClient(), 'sessions', ['engine_session_id'] as const, { agent_id: agent.id, owner_user_id: resolved.userId, engine_session_id: wanted })
    const owned = new Set((data ?? []).flatMap(row => row.engine_session_id ?? []))
    return { actor: resolved, agent, inReach: engineSessionId => owned.has(engineSessionId) }
}

export function assertRunInReach(reach: { inReach: (engineSessionId: string) => boolean }, run: { sessionId: string }): void {
    if (!reach.inReach(run.sessionId)) throw new AuthorizationError(COWORKER_NOT_FOUND)
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

// The coworkers of the Boxes the actor reaches, and the Chief of Staff, whom every member reaches.
export async function visibleAgentIds(actor: Actor): Promise<'all' | Set<string>> {
    const spaces = await visibleSpaceIds(actor)
    if (spaces === 'all') return 'all'
    const supabase = createServiceRoleClient()
    const [{ data: boxed }, { data: reachedByAll }] = await Promise.all([
        spaces.size ? selectAll(supabase, 'agents', ['id'] as const, { workspace_id: actor.workspaceId, space_id: [...spaces] }) : Promise.resolve({ data: [] }),
        selectAll(supabase, 'agents', ['id'] as const, { workspace_id: actor.workspaceId, kind: 'foreman' }),
    ])
    return new Set([...(boxed ?? []), ...(reachedByAll ?? [])].map(agent => agent.id))
}

// For a run started in someone's name: the engine ids of the coworkers they reach, which the engine
// narrows `call_agent` to. Undefined when they reach every Box, so the engine offers the whole
// machine as before.
export async function callableEngineAgentIds(actor: Actor): Promise<string[] | undefined> {
    if (isAdminActor(actor)) return undefined
    const map = await spaceAccessMap(actor)
    const visible = [...map].filter(([, access]) => access !== 'none').map(([id]) => id)
    if (visible.length === map.size) return undefined
    // Every member reaches the Chief of Staff, whatever Boxes they reach.
    if (visible.length === 0) return [FOREMAN_AGENT_ID]
    const { data: agents } = await selectAll(createServiceRoleClient(), 'agents', ['engine_agent_id'] as const, { workspace_id: actor.workspaceId, space_id: visible })
    return [...(agents ?? []).flatMap(agent => (agent.engine_agent_id ? [agent.engine_agent_id] : [])), FOREMAN_AGENT_ID]
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
export async function assertAgentInWorkspace(agentId: string, need: AccessLevel = 'use', actor?: Actor): Promise<AccessedAgent> {
    return (await assertAgentAccess(agentId, need, actor)).agent
}

async function sessionMemberOf(workspaceId: number): Promise<Actor | null> {
    const { user } = await getSessionWorkspace()
    if (!user?.id) throw new UnauthenticatedError()
    const { data: membership } = await selectMaybeSingle(createServiceRoleClient(), 'workspace_members', ['role', 'box_scope', 'organization_staff'] as const, { user_id: user.id, workspace_id: workspaceId })
    return membership && { kind: 'user', userId: user.id, workspaceId, role: membership.role, boxScope: toBoxScope(membership.box_scope), organizationStaff: membership.organization_staff }
}

// For an OAuth callback, which lands in a popup that names no workspace: the caller as a member of
// the one the sign-in started in, never of the one the session last picked.
export async function requireWorkspaceActor(workspaceId: number): Promise<Actor> {
    const actor = await sessionMemberOf(workspaceId)
    if (!actor) throw new AuthorizationError('notMember')
    return actor
}

// For an OAuth callback, which lands in a popup that names no workspace: the agent names its own,
// held to the caller's membership like a workspace a tab names. Connecting an app to a coworker
// changes what it is, so it takes `manage` on its Box. The Chief of Staff goes by `foreman` in every
// workspace, which names none: its sign-in carries the one it started in (`startedIn`), never the
// one the session last picked.
export async function requireAgentWorkspaceId(agentId: string, need: AccessLevel = 'manage', startedIn?: number): Promise<number> {
    const { user } = await getSessionWorkspace()
    if (!user?.id) throw new UnauthenticatedError()
    const supabase = createServiceRoleClient()
    const workspaceId = agentId === FOREMAN_AGENT_ID ? startedIn : (await selectMaybeSingle(supabase, 'agents', ['workspace_id'] as const, { id: agentId })).data?.workspace_id
    if (workspaceId === undefined) throw new AuthorizationError(COWORKER_NOT_FOUND)
    const actor = await sessionMemberOf(workspaceId)
    if (!actor) throw new AuthorizationError(COWORKER_NOT_FOUND)
    await assertAgentAccess(agentId, need, actor)
    return workspaceId
}

type OwnedSession = { id: string; agent_id: string; engine_session_id: string | null; engine_agent_id: string | null; updated_at: string; owner_user_id: string | null }

// Asserts a session belongs to an agent the caller can use (session -> agent -> Box), mirroring the
// RLS policy on sessions. The session, its agent and its Box come back in one read. `actor` is
// passed in by a caller that already started resolving it.
export async function assertSessionInWorkspace(sessionId: string, actor?: Promise<Actor> | Actor): Promise<OwnedSession> {
    const [callerActor, session] = await Promise.all([actor ?? requireLightSessionActor(), readSessionWithAgent(sessionId)])
    if (!session?.agent || session.agent.workspace_id !== callerActor.workspaceId) throw new AuthorizationError('sessionNotFound')
    // A conversation one member holds is theirs alone, whoever else reaches the coworker.
    if (session.owner_user_id && (callerActor.kind !== 'user' || callerActor.userId !== session.owner_user_id)) throw new AuthorizationError('sessionNotFound')
    if (!hasAccess(await agentAccessFor(callerActor, session.agent), 'use')) throw new AuthorizationError('sessionNotFound')
    return { id: session.id, agent_id: session.agent_id, engine_session_id: session.engine_session_id, engine_agent_id: session.agent.engine_agent_id, updated_at: session.updated_at, owner_user_id: session.owner_user_id }
}

// Postgres refusing a text that is not a uuid for the id column: no conversation can carry that id.
const INVALID_TEXT_REPRESENTATION = '22P02'

// A read that failed is thrown rather than taken for a missing session: answered as one, the chat
// would offer a new conversation, and drop its retry, for one that is still there.
async function readSessionWithAgent(sessionId: string) {
    const { data, error } = await selectMaybeSingleWithJoins(
        createServiceRoleClient(),
        'sessions',
        ['id', 'agent_id', 'engine_session_id', 'updated_at', 'owner_user_id'] as const,
        // Named, because origin_agent_id points at agents too.
        { agent: { table: 'agents', foreignKey: 'agents!sessions_agent_id_fkey', columns: ['workspace_id', 'kind', 'space_id', 'engine_agent_id'] } } as const,
        { id: sessionId },
    )
    if (error && error.code !== INVALID_TEXT_REPRESENTATION) throw new Error(`Failed to read session ${sessionId}: ${error.message}`)
    return data
}

// A member named by something the hub signed (a foreman turn's token), held to their membership
// as it stands now: someone who left since the token was minted reaches nothing.
export async function memberActor(workspaceId: number, userId: string): Promise<UserActor | null> {
    const { data: membership } = await selectMaybeSingle(createServiceRoleClient(), 'workspace_members', ['role', 'box_scope', 'organization_staff'] as const, { user_id: userId, workspace_id: workspaceId })
    if (!membership) return null
    return { kind: 'user', userId, workspaceId, role: membership.role, boxScope: toBoxScope(membership.box_scope), organizationStaff: membership.organization_staff }
}
