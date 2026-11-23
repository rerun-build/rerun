import { actorFromContext, assertAgentAccess, assertSessionInWorkspace, keepVisible, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import { AuthorizationError, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { createSessionRow, getSessionEngineContext, lastRunError, listSessionRuns, readUsageSeed, resolveAgentTarget, type SessionUsageSeed, updateSessionStatus } from '@/app/api/_services/chat.service'
import { type HistoryMessage, transformEngineMessages } from '@/lib/chat/engine-history'
import { EMPTY_SESSION_SNAPSHOT, type SessionSnapshot } from '@/lib/chat/session-snapshot'
import { openSkillProposal, pendingRequestPeek, type PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { ATTENTION_NOTIFICATION_COLUMNS, attentionDetailsOf, attentionNotificationsFilter } from '@/lib/notifications/attention-details'
import { sanitizeIlike } from '@/lib/search/ilike'
import { cancelRun, getSession, getSessionMessages, listRuns, listSessions, listSkillProposals } from '@/lib/engine/client'
import type { EngineSession, EngineSkillProposal, SessionSource } from '@/lib/engine/types'
import { sourcesOf, type SessionHistoryFilter } from '@/lib/chat/history-filter'
import { ATTENTION_STATUSES, CONVERSATION_TITLE_MAX, FOREMAN_AGENT_ID, agentKindPolicy, type AgentKind, needsHuman, sessionStatusSchema, type AgentConversationsOverview, type Conversation, type ConversationHit, type SessionKind, type SessionOutcome, type SessionStatus, type ToHandleList } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/supabase/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ensureForemanAgentRow } from '@/lib/foreman/agent-row'
import { copyToShippedForemanRow } from '@/lib/foreman/conversation'

export type SessionHistoryEntry = {
    id: string | null
    agentId: string
    engineSessionId: string
    title: string
    status: SessionStatus
    updatedAt: string
    source: SessionSource
    originAgentId: string | null
    originAgentName: string | null
    automationName: string | null
    outcome: SessionOutcome | null
    kind: SessionKind
    createdAt: string
    firstMessage: string | null
}

const HISTORY_COLUMNS = ['id', 'title', 'status', 'updated_at', 'created_at', 'engine_session_id', 'origin_agent_id', 'source', 'automation_name', 'outcome', 'kind', 'first_message'] as const

// PostgREST caps a select at 1000 rows, and a busy coworker runs thousands of routines: the history
// is read a page of the newest threads of the filter at a time.
export const SESSION_HISTORY_LIMIT = 200

// `before` reads the next page: the threads updated at or before it, the one on the edge coming back
// on both pages. Null once there is nothing older.
export type SessionHistoryPage = { entries: SessionHistoryEntry[]; before: string | null }

// The conversations of a coworker a caller reads: all of them, or for a coworker whose
// conversations are each member's own, the caller's alone (none for a caller who is no member).
function ownerFilterOf(agent: { kind: AgentKind }, caller: Actor): { filter: { owner_user_id?: string } } | null {
    if (agentKindPolicy(agent.kind).conversations === 'shared') return { filter: {} }
    return caller.kind === 'user' ? { filter: { owner_user_id: caller.userId } } : null
}

// Session history for an agent: Supabase-mirrored sessions merged with
// engine-only sessions that were initiated by another agent (call_agent),
// so those show up in the history like regular ones until adopted.
export async function listAgentSessions(agentId: string, actor?: Actor, filter: SessionHistoryFilter = 'all', before?: string): Promise<SessionHistoryPage> {
    const { actor: caller, agent } = await assertAgentAccess(agentId, 'use', actor)
    const owner = ownerFilterOf(agent, caller)
    if (!owner) return { entries: [], before: null }
    // The engine's unmirrored sessions belong to whoever started them: a coworker whose conversations
    // are each member's own lists none of them.
    const perMember = owner.filter.owner_user_id !== undefined

    const supabase = createServiceRoleClient()
    const sources = sourcesOf(filter)
    // Only `call_agent` opens a session on the engine alone, always with the source `agent`: a filter
    // that leaves it out has nothing to ask the Box for.
    const readsEngine = !sources || sources.includes('agent')

    const [threads, general, target] = await Promise.all([
        selectMany(supabase, 'sessions', HISTORY_COLUMNS, { agent_id: agent.id, ...owner.filter, kind: 'thread', source: sources, updated_at: before ? { lte: before } : undefined }, { column: 'updated_at', ascending: false }, SESSION_HISTORY_LIMIT),
        filter === 'all' && !before ? selectMany(supabase, 'sessions', HISTORY_COLUMNS, { agent_id: agent.id, ...owner.filter, kind: 'general' }) : { data: [], error: null },
        readsEngine && !perMember ? resolveAgentTarget(agentId, 'use', caller).catch(() => null) : null,
    ])
    if (threads.error) throw threads.error
    const threadRows = threads.data ?? []
    const supabaseRows = [...(general.data ?? []), ...threadRows]

    const engineSessions = target ? await listSessions(target.conn, target.engineAgentId).catch(() => []) : []
    const unmirrored = await engineOnlySessions(supabase, agent.id, engineSessions, threadRows, sources, before)

    const engineOriginIds = [...new Set(unmirrored.map(s => s.originAgentId).filter((v): v is string => !!v))]
    const supabaseOriginIds = [...new Set(supabaseRows.map(r => r.origin_agent_id).filter((v): v is string => !!v))]

    const byEngineId = new Map<string, { id: string; name: string }>()
    if (engineOriginIds.length > 0) {
        const { data } = await selectMany(supabase, 'agents', ['id', 'engine_agent_id', 'name'] as const, { workspace_id: caller.workspaceId, engine_agent_id: { in: engineOriginIds } })
        for (const a of data ?? []) if (a.engine_agent_id) byEngineId.set(a.engine_agent_id, { id: a.id, name: a.name })
    }

    const namesById = new Map<string, string>()
    if (supabaseOriginIds.length > 0) {
        const { data } = await selectMany(supabase, 'agents', ['id', 'name'] as const, { id: { in: supabaseOriginIds } })
        for (const a of data ?? []) namesById.set(a.id, a.name)
    }

    const entries: SessionHistoryEntry[] = [
        ...supabaseRows.map(r => ({
            id: r.id,
            agentId,
            engineSessionId: r.engine_session_id,
            title: r.title,
            status: r.status,
            updatedAt: r.updated_at,
            source: (r.source ?? 'dashboard') as SessionSource,
            originAgentId: r.origin_agent_id,
            originAgentName: r.origin_agent_id ? (namesById.get(r.origin_agent_id) ?? 'another coworker') : null,
            automationName: r.automation_name,
            outcome: r.outcome,
            kind: r.kind,
            createdAt: r.created_at,
            firstMessage: r.first_message,
        })),
        ...unmirrored.map(s => ({
            id: null,
            agentId,
            engineSessionId: s.id,
            title: s.title,
            // The engine's own status only says the session exists ('open'); nothing runs on it
            // from the hub's point of view until it is adopted.
            status: sessionStatusSchema.catch('idle').parse(s.status),
            updatedAt: s.updatedAt,
            source: s.source,
            originAgentId: s.originAgentId ? (byEngineId.get(s.originAgentId)?.id ?? null) : null,
            originAgentName: s.originAgentId ? (byEngineId.get(s.originAgentId)?.name ?? 'another coworker') : null,
            automationName: null,
            outcome: null,
            kind: 'thread' as const,
            createdAt: s.createdAt,
            firstMessage: null,
        })),
    ]

    const byNewest = (a: SessionHistoryEntry, b: SessionHistoryEntry) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    const allThreads = entries.filter(entry => entry.kind !== 'general').sort(byNewest)
    const newestThreads = allThreads.slice(0, SESSION_HISTORY_LIMIT)
    // What the cut leaves out is older than the last thread kept, so the next page brings it back.
    const hasOlder = threadRows.length === SESSION_HISTORY_LIMIT || allThreads.length > SESSION_HISTORY_LIMIT
    return {
        entries: [...entries.filter(entry => entry.kind === 'general'), ...newestThreads].sort(byNewest),
        before: hasOlder ? (newestThreads.at(-1)?.updatedAt ?? null) : null,
    }
}

// The engine's sessions another coworker opened on this one that have no row yet, within the page:
// not newer than `before`, and not older than its oldest row when the page is full (the next one
// reads those). Past the first page, or on a full one, the page is not every row of the filter, so
// the candidates are checked against the table rather than against the page.
async function engineOnlySessions(supabase: SupabaseClient<Database>, agentId: string, engineSessions: EngineSession[], page: { engine_session_id: string; updated_at: string }[], sources: SessionSource[] | undefined, before: string | undefined): Promise<EngineSession[]> {
    const onPage = new Set(page.map(row => row.engine_session_id))
    const newest = before ? new Date(before).getTime() : Infinity
    const candidates = engineSessions.filter(s => s.originAgentId && !onPage.has(s.id) && (!sources || sources.includes(s.source)) && new Date(s.updatedAt).getTime() <= newest)
    const pageFull = page.length === SESSION_HISTORY_LIMIT
    if ((!pageFull && !before) || candidates.length === 0) return candidates

    const oldest = pageFull ? Math.min(...page.map(row => new Date(row.updated_at).getTime())) : -Infinity
    const inWindow = candidates
        .filter(s => new Date(s.updatedAt).getTime() >= oldest)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, SESSION_HISTORY_LIMIT)
    if (inWindow.length === 0) return []
    const { data, error } = await selectMany(supabase, 'sessions', ['engine_session_id'] as const, { agent_id: agentId, engine_session_id: inWindow.map(s => s.id) })
    if (error) throw error
    const mirrored = new Set((data ?? []).map(row => row.engine_session_id))
    return inWindow.filter(s => !mirrored.has(s.id))
}

export type ThreadRow = {
    id: string
    title: string
    status: SessionStatus
    source: SessionSource
    createdAt: string
    updatedAt: string
    originAgentId: string | null
    automationName: string | null
    outcome: SessionOutcome | null
    // What the thread opened with, when a person typed it in the app; null for a run the engine
    // started and for threads older than the column.
    firstMessage: string | null
}

export const THREAD_COLUMNS = ['id', 'title', 'status', 'source', 'created_at', 'updated_at', 'origin_agent_id', 'automation_name', 'outcome', 'first_message'] as const

// PostgREST caps a select at 1000 rows: General shows the newest threads, the Threads list stays
// the way to every older one.
export const THREAD_FEED_LIMIT = 200

// The threads General hangs under its messages, newest first. Read from Supabase alone: the engine
// mirrors every conversation it opens on its own (`agent.session.created`), and the live state
// comes from the board store, so there is nothing to ask the Box for here.
export async function listAgentThreads(agentId: string, actor?: Actor): Promise<ThreadRow[]> {
    const { actor: caller, agent } = await assertAgentAccess(agentId, 'use', actor)
    const owner = ownerFilterOf(agent, caller)
    if (!owner) return []
    const { data, error } = await selectMany(createServiceRoleClient(), 'sessions', THREAD_COLUMNS, { agent_id: agent.id, kind: 'thread', ...owner.filter }, { column: 'created_at', ascending: false }, THREAD_FEED_LIMIT)
    if (error) throw error
    return (data ?? []).map(row => ({
        id: row.id,
        title: row.title,
        status: row.status,
        source: (row.source ?? 'dashboard') as SessionSource,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        originAgentId: row.origin_agent_id,
        automationName: row.automation_name,
        outcome: row.outcome,
        firstMessage: row.first_message,
    }))
}

// The app's list of a coworker's conversations: the history, plus what the inbox knows of each one,
// whether a run finished since the caller last opened it, and what a waiting one asks.
export async function listAgentConversations(ctx: WorkspaceContext, agentId: string): Promise<Conversation[]> {
    const { entries } = await listAgentSessions(agentId, actorFromContext(ctx))
    const waiting = entries.flatMap(entry => (entry.id && needsHuman(entry.status) ? [{ id: entry.id, agent_id: entry.agentId, engine_session_id: entry.engineSessionId, title: entry.title, updated_at: entry.updatedAt }] : []))
    const filter = attentionNotificationsFilter(waiting)

    // `unseen_runs` answers for `auth.uid()`: it runs as the caller, not through the service role.
    const asCaller = await createClient()
    const [unseen, notifications, tErrors] = await Promise.all([
        asCaller.rpc('unseen_runs', { p_workspace_id: ctx.workspace.id }),
        filter ? selectMany(ctx.supabase, 'notifications', ATTENTION_NOTIFICATION_COLUMNS, filter, { column: 'created_at', ascending: false }) : { data: [], error: null },
        recipientLocale(ctx.supabase, ctx.userId, ctx.workspace.id).then(locale => translatorFor(locale, 'chatErrors')),
    ])
    const unseenIds = unseen.error ? null : new Set((unseen.data ?? []).filter(run => run.agent_id === agentId).map(run => run.session_id))
    const details = notifications.error ? {} : attentionDetailsOf(waiting, notifications.data ?? [], ctx.userId, tErrors)

    return entries.map(entry => ({
        ...entry,
        ...(unseenIds && { unseen: !!entry.id && unseenIds.has(entry.id) }),
        ask: entry.id ? (details[entry.id]?.message ?? null) : null,
    }))
}

// The workspace's coworkers whose Box the caller reaches: every list of conversations stops there.
function reachableAgents(ctx: WorkspaceContext): Promise<{ id: string; name: string }[]> {
    return agentsReachedBy(actorFromContext(ctx), ctx.supabase)
}

async function agentsReachedBy(actor: Actor, supabase: SupabaseClient<Database>): Promise<{ id: string; name: string }[]> {
    const [{ data, error }, spaces] = await Promise.all([selectMany(supabase, 'agents', ['id', 'name', 'space_id'] as const, { workspace_id: actor.workspaceId, kind: 'coworker' }), visibleSpaceIds(actor)])
    if (error) throw error
    return keepVisible(data ?? [], spaces, agent => agent.space_id)
}

const OVERVIEW_COLUMNS = ['id', 'engine_session_id', 'source'] as const

// What the app badges on an agent row: a conversation it cannot move forward without a human. An
// errored one is not counted, the row says "Error" on its own.
const PENDING_STATUSES = ['awaiting_question', 'awaiting_approval', 'awaiting_connector', 'awaiting_ack'] as const

type CoworkerPreviewRow = Database['public']['Functions']['coworker_previews']['Returns'][number]

function lastMessageOf(row: CoworkerPreviewRow, userId: string): Conversation['lastMessage'] {
    if (!row.last_message || (row.last_message_from !== 'user' && row.last_message_from !== 'agent')) return null
    return { text: row.last_message, mine: row.last_message_from === 'user' && row.last_message_author_id === userId }
}

// The whole Chats screen in one request, bounded by the coworkers rather than their conversations:
// `coworker_previews` reads each coworker's latest conversation in one probe of an index, with the
// last thing said in it, as the web's list does. Engine-only conversations (opened on this agent by
// another one, not adopted yet) are left out on purpose: they are always idle, so they change
// neither the count nor the latest row, and skipping them is what keeps this off the Boxes.
export async function listWorkspaceConversationOverview(ctx: WorkspaceContext): Promise<AgentConversationsOverview> {
    const agentIds = (await reachableAgents(ctx)).map(a => a.id)
    if (agentIds.length === 0) return []

    // As the caller, like the web's list: the function is theirs to run, and its policies stop at the Boxes they reach.
    const asCaller = await createClient()
    // A coworker has one General at most: that read is bounded by the coworkers too.
    const [previews, { data: pendingRows, error: pendingError }, { data: generalRows, error: generalError }] = await Promise.all([
        asCaller.rpc('coworker_previews', { p_workspace_id: ctx.workspace.id }),
        selectMany(ctx.supabase, 'sessions', ['agent_id'] as const, { agent_id: agentIds, status: [...PENDING_STATUSES] }),
        selectMany(ctx.supabase, 'sessions', ['id', 'agent_id'] as const, { agent_id: agentIds, kind: 'general' }),
    ])
    if (previews.error) throw previews.error
    if (pendingError) throw pendingError
    if (generalError) throw generalError

    const reachable = new Set(agentIds)
    const latestRows = (previews.data ?? []).filter((row): row is CoworkerPreviewRow & { session_id: string; title: string; status: SessionStatus; updated_at: string } => reachable.has(row.agent_id) && !!row.session_id && row.title !== null && !!row.status && !!row.updated_at)
    const { data: details, error: detailsError } = latestRows.length > 0 ? await selectMany(ctx.supabase, 'sessions', OVERVIEW_COLUMNS, { id: latestRows.map(row => row.session_id) }) : { data: [], error: null }
    if (detailsError) throw detailsError
    const detailsById = new Map((details ?? []).map(row => [row.id, row]))

    const latestByAgent = new Map<string, Conversation>()
    for (const row of latestRows) {
        const detail = detailsById.get(row.session_id)
        if (!detail) continue
        latestByAgent.set(row.agent_id, {
            id: row.session_id,
            agentId: row.agent_id,
            engineSessionId: detail.engine_session_id,
            title: row.title,
            status: row.status,
            source: (detail.source ?? 'dashboard') as SessionSource,
            updatedAt: row.updated_at,
            // Resolving the origin agent would cost a second lookup for a label the row never
            // shows: the Chats screen prints the status, the agent's own history prints the name.
            originAgentName: null,
            lastMessage: lastMessageOf(row, ctx.userId),
        })
    }

    const pendingByAgent = new Map<string, number>()
    for (const row of pendingRows ?? []) pendingByAgent.set(row.agent_id, (pendingByAgent.get(row.agent_id) ?? 0) + 1)
    const generalByAgent = new Map((generalRows ?? []).map(row => [row.agent_id, row.id]))

    return agentIds.map(agentId => ({ agentId, latest: latestByAgent.get(agentId) ?? null, pending: pendingByAgent.get(agentId) ?? 0, generalSessionId: generalByAgent.get(agentId) ?? null }))
}

const SEARCH_COLUMNS = ['id', 'agent_id', 'title', 'status', 'updated_at'] as const

const SEARCH_LIMIT = 20
const AGENT_RECENT_LIMIT = 8

export type { ConversationHit } from '@rerun/contracts'

// Conversations found by their title, newest first, for the control center. Scoped through the
// coworkers the caller reaches, which is also what proves a given `agentId` is the caller's to read. With
// an agent and no text it lists that agent's latest ones. Engine-only conversations have no row to
// match and are left out, as in the overview above.
export async function searchWorkspaceConversations(ctx: WorkspaceContext, query: string, agentId?: string): Promise<ConversationHit[]> {
    const text = sanitizeIlike(query)
    if (!text && !agentId) return []

    // The Chief of Staff's conversations are the caller's own: found among theirs, under the name the apps call it by.
    const foremanId = !agentId || agentId === FOREMAN_AGENT_ID ? await ensureForemanAgentRow(ctx.supabase, ctx.workspace.id) : null
    const workspaceAgentIds = agentId === FOREMAN_AGENT_ID ? [] : (await reachableAgents(ctx)).map(a => a.id)
    const agentIds = agentId && agentId !== FOREMAN_AGENT_ID ? workspaceAgentIds.filter(id => id === agentId) : workspaceAgentIds
    if (agentIds.length === 0 && !foremanId) return []

    const titled = text ? { title: { ilike: `%${text}%` } } : {}
    const limit = text ? SEARCH_LIMIT : AGENT_RECENT_LIMIT
    const [coworkers, foreman] = await Promise.all([
        agentIds.length ? selectMany(ctx.supabase, 'sessions', SEARCH_COLUMNS, { agent_id: agentIds, ...titled }, { column: 'updated_at', ascending: false }, limit) : Promise.resolve({ data: [], error: null }),
        foremanId ? selectMany(ctx.supabase, 'sessions', SEARCH_COLUMNS, { agent_id: foremanId, owner_user_id: ctx.userId, ...titled }, { column: 'updated_at', ascending: false }, limit) : Promise.resolve({ data: [], error: null }),
    ])
    if (coworkers.error) throw coworkers.error
    if (foreman.error) throw foreman.error

    const hits = [...(coworkers.data ?? []), ...(foreman.data ?? [])].map(row => ({ id: row.id, agentId: row.agent_id === foremanId ? FOREMAN_AGENT_ID : row.agent_id, title: row.title, status: row.status, updatedAt: row.updated_at }))
    return hits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit)
}

const TO_HANDLE_COLUMNS = ['id', 'agent_id', 'title', 'status', 'updated_at'] as const

// The three requests an agent is blocked on, and the three states it merely leaves behind. They are
// read separately so the blocking ones are never pushed out of the page by a pile of old errors,
// which is exactly what a busy workspace accumulates.
const BLOCKING_STATUSES = ['awaiting_question', 'awaiting_approval', 'awaiting_connector'] as const
const TRAILING_STATUSES = ATTENTION_STATUSES.filter(status => !BLOCKING_STATUSES.includes(status as (typeof BLOCKING_STATUSES)[number]))

// How many rows each half of the page brings back. The count beside them stays exact.
const TO_HANDLE_PAGE = 50

// Everything in the workspace waiting on its human, the list the web's To handle tab shows for one
// agent at a time, bounded and with the blocking requests first.
export async function listWorkspaceToHandle(ctx: WorkspaceContext): Promise<ToHandleList> {
    const namesById = new Map((await reachableAgents(ctx)).map(a => [a.id, a.name]))
    if (namesById.size === 0) return { items: [], total: 0 }

    const agentIds = [...namesById.keys()]
    const newestFirst = { column: 'updated_at', ascending: false } as const

    const [blocking, trailing, counted] = await Promise.all([
        selectMany(ctx.supabase, 'sessions', TO_HANDLE_COLUMNS, { agent_id: agentIds, status: [...BLOCKING_STATUSES] }, newestFirst, TO_HANDLE_PAGE),
        selectMany(ctx.supabase, 'sessions', TO_HANDLE_COLUMNS, { agent_id: agentIds, status: [...TRAILING_STATUSES] }, newestFirst, TO_HANDLE_PAGE),
        selectCount(ctx.supabase, 'sessions', { agent_id: agentIds, status: [...ATTENTION_STATUSES] }),
    ])
    if (blocking.error) throw blocking.error
    if (trailing.error) throw trailing.error
    if (counted.error) throw counted.error

    const items = [...(blocking.data ?? []), ...(trailing.data ?? [])].map(row => ({
        sessionId: row.id,
        agentId: row.agent_id,
        agentName: namesById.get(row.agent_id) ?? 'Coworker',
        title: row.title,
        status: row.status,
        updatedAt: row.updated_at,
    }))

    return { items, total: counted.data ?? items.length }
}

export type PendingCard = { sessionId: string; agentId: string; agentName: string; title: string; status: string; updatedAt: string; peek: PendingRequestPeek }

const PENDING_CARDS_PAGE = 20

// The cards the caller's coworkers stopped on, each with what it asks, for the Chief of Staff to
// answer in their name. Only the requests that block a run: a heads-up or an error asks for nothing.
// The Chief of Staff's own threads have no agent row, so they never show here.
export async function listPendingCards(actor: Actor): Promise<PendingCard[]> {
    const supabase = createServiceRoleClient()
    const namesById = new Map((await agentsReachedBy(actor, supabase)).map(agent => [agent.id, agent.name]))
    if (namesById.size === 0) return []

    const { data, error } = await selectMany(supabase, 'sessions', TO_HANDLE_COLUMNS, { agent_id: [...namesById.keys()], status: [...BLOCKING_STATUSES] }, { column: 'updated_at', ascending: false }, PENDING_CARDS_PAGE)
    if (error) throw error

    const cards = await Promise.all(
        (data ?? []).map(async (row): Promise<PendingCard | null> => {
            const peek = await readPendingRequest(row.id, actor).catch(() => null)
            if (!peek) return null
            return { sessionId: row.id, agentId: row.agent_id, agentName: namesById.get(row.agent_id) ?? 'Coworker', title: row.title, status: row.status, updatedAt: row.updated_at, peek }
        })
    )
    return cards.filter(card => card !== null)
}

// Acknowledging without answering, the same write the board store makes behind « Mark as read ».
// `'all'` empties what the caller reaches, which is what the button of that name promises even when
// the list it sits above only showed a page. The agent filter is what scopes the write; the
// status filter is the race guard: a conversation back in `working` between the render and the tap
// belongs to its run.
export async function markSessionsHandled(ctx: WorkspaceContext, sessionIds: string[] | 'all'): Promise<void> {
    const supabase = createServiceRoleClient()
    const [agentIds, chief] = await Promise.all([reachableAgents(ctx).then(agents => agents.map(a => a.id)), selectMaybeSingle(supabase, 'agents', ['id'] as const, { workspace_id: ctx.workspace.id, kind: 'foreman' })])
    const handled = (agentId: string[] | string, owner?: string) => {
        let update = supabase
            .from('sessions')
            .update<Database['public']['Tables']['sessions']['Update']>({ status: 'idle' })
            .in('agent_id', Array.isArray(agentId) ? agentId : [agentId])
            .in('status', [...ATTENTION_STATUSES])
        if (owner) update = update.eq('owner_user_id', owner)
        if (sessionIds !== 'all') update = update.in('id', sessionIds)
        return update.select('id')
    }
    if (agentIds.length) await handled(agentIds)
    // The Chief of Staff's conversations with the caller, theirs alone to set aside.
    if (chief.data) for (const row of (await handled(chief.data.id, ctx.userId)).data ?? []) await copyToShippedForemanRow(row.id)
}

// The name a person gives a conversation, shared by everyone who reaches it. General keeps its
// fixed name: the `kind` filter leaves its row untouched, and no row written means nothing renamed.
export async function renameSession(sessionId: string, title: string): Promise<boolean> {
    const name = title.trim().slice(0, CONVERSATION_TITLE_MAX)
    if (!name) return false
    const session = await assertSessionInWorkspace(sessionId)
    const { data } = await createServiceRoleClient().from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ title: name }).eq('id', session.id).eq('kind', 'thread').select('id')
    if (data?.length) await copyToShippedForemanRow(session.id)
    return !!data?.length
}

// Creates the Supabase mirror row for an engine-only session so it can be
// opened and continued like a regular session. Idempotent per engine session.
export async function adoptEngineSession(agentId: string, engineSessionId: string, title: string, actor?: Actor): Promise<string> {
    const { actor: caller, agent } = await assertAgentAccess(agentId, 'use', actor)
    const workspaceId = agent.workspace_id
    const supabase = createServiceRoleClient()

    const { data: existing } = await selectMaybeSingle(supabase, 'sessions', ['id'] as const, { agent_id: agentId, engine_session_id: engineSessionId })
    if (existing) return existing.id

    const target = await resolveAgentTarget(agentId, 'use', caller)
    const session = (await getSession(target.conn, target.engineAgentId, engineSessionId)) ?? (await listSessions(target.conn, target.engineAgentId)).find(s => s.id === engineSessionId)
    // A row is only ever a mirror of a session this agent holds: the column is unique across
    // workspaces, so a made-up id would otherwise squat another workspace's session.
    if (!session) throw new AuthorizationError('conversationNotFound')

    let originAgentId: string | null = null
    if (session?.originAgentId) {
        const { data: origin } = await selectMaybeSingle(supabase, 'agents', ['id'] as const, { engine_agent_id: session.originAgentId, workspace_id: workspaceId })
        originAgentId = origin?.id ?? null
    }

    return createSessionRow(agentId, engineSessionId, title, originAgentId, session?.source)
}

export async function readSessionMessages(sessionId: string): Promise<HistoryMessage[]> {
    return (await readSessionTranscript(sessionId)).messages
}

// The transcript with the time the session row last changed, read before the messages: a change
// landing between the two leaves the time older than the messages, never newer.
export async function readSessionTranscript(sessionId: string, actor?: Actor): Promise<{ messages: HistoryMessage[]; updatedAt: string | null }> {
    const ctx = await getSessionEngineContext(sessionId, actor)
    if (!ctx || !ctx.engineSessionId) return { messages: [], updatedAt: ctx?.updatedAt ?? null }

    const messages = await getSessionMessages(ctx.conn, ctx.engineAgentId, ctx.engineSessionId)
    return { messages: transformEngineMessages(messages), updatedAt: ctx.updatedAt ?? null }
}

// What the conversation waits on, read the way the chat would read it when opened. Without its
// proposals, the request is still worth showing.
export async function readPendingRequest(sessionId: string, actor?: Actor): Promise<PendingRequestPeek> {
    const ctx = await getSessionEngineContext(sessionId, actor)
    if (!ctx || !ctx.engineSessionId) return pendingRequestPeek([])
    const { conn, engineAgentId, engineSessionId } = ctx
    const [messages, proposals] = await Promise.all([getSessionMessages(conn, engineAgentId, engineSessionId).then(transformEngineMessages), listSkillProposals(conn, engineAgentId, engineSessionId).catch(() => [])])
    return pendingRequestPeek(messages, openSkillProposal(proposals))
}

// Everything a reopened conversation shows, from one resolution of the session and one read of its
// runs. Each part fails on its own: a transcript with no usage gauge beats no transcript at all.
export async function readSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
    const ctx = await getSessionEngineContext(sessionId)
    if (!ctx || !ctx.engineSessionId) return EMPTY_SESSION_SNAPSHOT
    const { conn, engineAgentId, engineSessionId } = ctx

    const [messages, runs, proposals] = await Promise.all([
        getSessionMessages(conn, engineAgentId, engineSessionId)
            .then(transformEngineMessages)
            .catch(() => []),
        listSessionRuns(conn, engineAgentId, engineSessionId).catch(() => null),
        listSkillProposals(conn, engineAgentId, engineSessionId).catch(() => []),
    ])
    const usage = runs?.lastDone ? await readUsageSeed(conn, engineAgentId, runs.lastDone).catch(() => null) : null

    return { messages, usage, lastError: lastRunError(runs?.latest), activeRunId: runs?.running?.id ?? null, proposals }
}

// Stop covers the whole conversation, not just the run this client happens to be streaming. A run
// nobody holds the id of anymore — a tab closed mid-stream, a duplicate send that raced — would
// otherwise keep going and write its answer minutes later, on top of what the agent already said.
export async function cancelSessionRuns(sessionId: string): Promise<void> {
    const ctx = await getSessionEngineContext(sessionId)
    if (!ctx || !ctx.engineSessionId) return
    const runs = await listRuns(ctx.conn, ctx.engineAgentId, { sessionId: ctx.engineSessionId, status: 'running', limit: 200 })
    const running = runs.filter(r => r.sessionId === ctx.engineSessionId && r.status === 'running')
    await Promise.all(running.map(r => cancelRun(ctx.conn, ctx.engineAgentId, r.id).catch(() => {})))
}

// `onlyWhileWorking` is the reconnection's safety net: the engine's notification already settles a run's
// end (`done` to idle, a card to `awaiting_*`), so that write may only catch a session left `working`
// and never move one that waits on an answer. A stop or a closed card passes no option.
export async function finalizeSession(sessionId: string, status: 'idle' | 'error', options?: { onlyWhileWorking?: boolean }): Promise<void> {
    await assertSessionInWorkspace(sessionId)
    if (!options?.onlyWhileWorking) return updateSessionStatus(sessionId, status)
    await createServiceRoleClient().from('sessions').update<Database['public']['Tables']['sessions']['Update']>({ status }).eq('id', sessionId).eq('status', 'working')
}
