import 'server-only'

import { ATTENTION_STATUSES } from '@rerun/contracts'

import { isAdminActor, keepVisible, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import { workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { readRerunCredit } from '@/app/api/_services/ai-status-hub.service'
import { readGettingStartedItems } from '@/app/api/_services/getting-started.service'
import { resolveMemberIdentities } from '@/app/api/_services/members.service'
import { listVault } from '@/app/api/_services/vault.service'
import { createWorkspaceInvite } from '@/app/api/_services/workspace-invite.service'
import { progressOf } from '@/lib/onboarding/getting-started'
import { asStringArray } from '@/lib/mcp/args'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { FOREMAN_OVERVIEW_TOOL_DEFS, WORKSPACE_OVERVIEW_SECTIONS } from './tool-defs'

export const FOREMAN_OVERVIEW_TOOL_NAMES: ReadonlySet<string> = new Set(FOREMAN_OVERVIEW_TOOL_DEFS.map(def => def.name))

type Section = (typeof WORKSPACE_OVERVIEW_SECTIONS)[number]

const FAILED_WITHIN_MS = 48 * 60 * 60 * 1000
const LIST_MAX = 20
const INVITE_MAX = 10

function sectionsOf(value: unknown): Section[] {
    const asked = asStringArray(value).filter((name): name is Section => (WORKSPACE_OVERVIEW_SECTIONS as readonly string[]).includes(name))
    return asked.length ? asked : [...WORKSPACE_OVERVIEW_SECTIONS]
}

async function attention(actor: Actor) {
    const supabase = createServiceRoleClient()
    const [{ data: agentRows }, spaces] = await Promise.all([selectMany(supabase, 'agents', ['id', 'name', 'space_id', 'disabled_at', 'disabled_reason'] as const, { workspace_id: actor.workspaceId }), visibleSpaceIds(actor)])
    const agents = keepVisible(agentRows ?? [], spaces, agent => agent.space_id)
    const names = new Map(agents.map(agent => [agent.id, agent.name]))
    const ids = [...names.keys()]
    const since = new Date(Date.now() - FAILED_WITHIN_MS).toISOString()
    const columns = ['agent_id', 'title', 'status', 'updated_at'] as const
    const newest = { column: 'updated_at', ascending: false } as const
    const [waiting, failed, vault] = await Promise.all([
        ids.length ? selectMany(supabase, 'sessions', columns, { agent_id: ids, status: ATTENTION_STATUSES.filter(status => status !== 'error') }, newest, LIST_MAX) : Promise.resolve({ data: [] }),
        ids.length ? selectMany(supabase, 'sessions', columns, { agent_id: ids, status: 'error', updated_at: { gte: since } }, newest, LIST_MAX) : Promise.resolve({ data: [] }),
        listVault(actor).catch(() => null),
    ])
    const rowOf = (session: { agent_id: string; title: string | null; status: string; updated_at: string }) => ({ coworker: names.get(session.agent_id) ?? null, coworkerId: session.agent_id, conversation: session.title, status: session.status, since: session.updated_at })
    return {
        waiting: (waiting.data ?? []).map(rowOf),
        failed: (failed.data ?? []).map(rowOf),
        paused: agents.filter(agent => agent.disabled_at).map(agent => ({ coworker: agent.name, coworkerId: agent.id, reason: agent.disabled_reason })),
        signedOutApps: (vault?.entries ?? []).filter(entry => entry.status === 'needs_auth').map(entry => ({ id: entry.id, name: entry.name, account: entry.label ?? null })),
    }
}

async function usage(workspaceId: number) {
    const [{ credit }, { data: workspace }] = await Promise.all([readRerunCredit(workspaceId).catch(() => ({ credit: null })), selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['subscription_status', 'trial_ends_at'] as const, { id: workspaceId })])
    return {
        subscription: workspace?.subscription_status ?? null,
        trialEndsAt: workspace?.subscription_status === 'trialing' ? workspace.trial_ends_at : null,
        rerunCredit: credit ? { remainingUsd: credit.remainingMicros / 1_000_000, usedUsd: credit.usedMicros / 1_000_000, renewsAt: credit.resetsAt, paused: credit.paused } : null,
    }
}

async function gettingStarted(workspaceId: number) {
    const progress = progressOf(await readGettingStartedItems(createServiceRoleClient(), workspaceId), null)
    return Object.fromEntries(Object.entries(progress).filter(([, done]) => done !== null))
}

// First names and roles, never an address: what it reads may be quoted to anyone it writes to.
async function members(workspaceId: number) {
    const supabase = createServiceRoleClient()
    const { data: rows } = await selectMany(supabase, 'workspace_members', ['user_id', 'role'] as const, { workspace_id: workspaceId })
    const ids = (rows ?? []).map(row => row.user_id)
    const [identities, { data: users }] = await Promise.all([resolveMemberIdentities(supabase, ids), ids.length ? selectMany(supabase, 'users', ['id', 'last_active_at'] as const, { id: ids }) : Promise.resolve({ data: [] })])
    const activeAt = new Map((users ?? []).map(user => [user.id, user.last_active_at]))
    return (rows ?? []).map(row => ({ memberId: row.user_id, name: identities.get(row.user_id)?.name ?? null, role: row.role, lastActiveAt: activeAt.get(row.user_id) ?? null }))
}

// The addresses only to an admin in a conversation: a wake writes to someone else's notifications.
async function invites(actor: Actor, wake: boolean) {
    const { data } = await selectMany(createServiceRoleClient(), 'workspace_invitations', ['email', 'created_at', 'expires_at'] as const, { workspace_id: actor.workspaceId, status: 'pending' }, { column: 'created_at', ascending: false })
    const pending = data ?? []
    const named = !wake && isAdminActor(actor)
    return { pending: pending.length, ...(named ? { emails: pending.map(invite => invite.email) } : {}) }
}

async function workspaceOverview(actor: Actor, args: Record<string, unknown>, wake: boolean) {
    const sections = sectionsOf(args.sections)
    const read: Record<Section, () => Promise<unknown>> = {
        attention: () => attention(actor),
        usage: () => usage(actor.workspaceId),
        getting_started: () => gettingStarted(actor.workspaceId),
        members: () => members(actor.workspaceId),
        invites: () => invites(actor, wake),
    }
    const entries = await Promise.all(sections.map(async section => [section, await read[section]().catch(err => ({ error: err instanceof Error ? err.message : 'unavailable' }))] as const))
    return Object.fromEntries(entries)
}

async function inviteMembers(actor: Actor, args: Record<string, unknown>) {
    if (!isAdminActor(actor)) throw new Error('Only an admin of the workspace can invite people: say so, and suggest they ask one.')
    const emails = [...new Set(asStringArray(args.emails).map(email => email.trim()).filter(Boolean))]
    if (!emails.length) throw new Error('Pass the addresses to invite.')
    if (emails.length > INVITE_MAX) throw new Error(`At most ${INVITE_MAX} addresses at a time.`)
    const supabase = createServiceRoleClient()
    const inviterId = actor.kind === 'user' ? actor.userId : await workspaceFounderUserId(actor.workspaceId)
    if (!inviterId) throw new Error('This workspace has no member to invite on behalf of.')
    const [{ data: workspace }, { data: inviter }] = await Promise.all([selectMaybeSingle(supabase, 'workspaces', ['id', 'name', 'max_seats'] as const, { id: actor.workspaceId }), supabase.auth.admin.getUserById(inviterId)])
    if (!workspace) throw new Error('Workspace not found.')
    const boxScope = args.boxScope === 'assigned' ? 'assigned' : 'all'
    const results = []
    for (const email of emails) results.push(await createWorkspaceInvite({ supabase, workspace, inviterId, inviterEmail: inviter.user?.email ?? null, email, boxScope }))
    return { invites: results.map(result => (result.ok ? { email: result.email, invited: true, ...(result.inviteUrl ? { link: result.inviteUrl } : {}) } : { email: result.email, invited: false, reason: result.code })) }
}

export async function dispatchForemanOverviewTool(actor: Actor, tool: string, args: Record<string, unknown>, { wake = false }: { wake?: boolean } = {}): Promise<unknown> {
    if (tool === 'workspace_overview') return workspaceOverview(actor, args, wake)
    if (tool === 'invite_members') return inviteMembers(actor, args)
    throw new Error(`Unknown overview tool: ${tool}`)
}
