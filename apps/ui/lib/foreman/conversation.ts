import 'server-only'

import { FOREMAN_AGENT_ID, type Conversation, type SessionKind, type SessionSource, type SessionStatus } from '@rerun/contracts'
import type { UIMessage } from 'ai'

import { workspaceFounderUserId, type WorkspaceContext } from '@/app/api/_auth/ownership'
import { FIRST_MESSAGE_MAX_CHARS, GENERAL_SESSION_TITLE, GeneralAlreadyOpenError, lastRunError, listSessionRuns, readUsageSeed, type GeneralSession, type SessionUsageSeed } from '@/app/api/_services/chat.service'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import { generateSessionTitle } from '@/lib/ai/generate-title'
import { seedSessionTitle } from '@/lib/chat/session-title'
import { transformEngineMessages } from '@/lib/chat/engine-history'
import { openSkillProposal, pendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { cancelRun, getSessionMessages, listRuns, listSkillProposals } from '@/lib/engine/client'
import type { EngineConnection, EngineSkillProposal } from '@/lib/engine/types'
import type { ForemanBackend } from './phase'
import { stripAttachmentsRef } from '@/lib/chat/attachments-marker'
import { dedupeMessagesById } from '@/lib/foreman/dedupe-messages'
import { isKickoffText } from '@/lib/foreman/kickoff-marker'
import { coworkerRuleOf, normalizeNotificationPrefs } from '@/lib/notifications/prefs'
import { stripVoiceMarker } from '@/lib/voice/marker'
import { createClient } from '@/supabase/server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle, selectMaybeSingleWithJoins } from '@/supabase/supabase-helpers'
import { ensureForemanAgentRow } from './agent-row'

// A conversation with the Chief of Staff on the engine is a `sessions` row of its agent row, owned by
// the member who holds it: the transcript stays on the engine, the row says whose it is and where to
// read it. The onboarding's conversations on the hub stay in `foreman_conversations`, rewritten whole
// at the end of each turn: onFinish hands back the updated UIMessage list, and replacing it is both
// simpler and more faithful than diffing parts that the SDK may have merged.

// What only an engine conversation has: its runs live on the engine, so the gauge, the failure of a
// run that died without answering and the run still in flight are read back with the transcript.
export type ForemanRunState = { usage: SessionUsageSeed | null; lastError: string | null; activeRunId: string | null }

// `proposals`: the skill proposals still waiting in it, handed over with the transcript so the
// column does not ask for them in a call of its own.
export type ForemanConversation = { sessionId: string; title: string | null; backend: ForemanBackend; kind: SessionKind; messages: UIMessage[]; proposals: EngineSkillProposal[] } & ForemanRunState

const NO_RUN_STATE: ForemanRunState = { usage: null, lastError: null, activeRunId: null }

const HUB_CONVERSATION_COLUMNS = ['id', 'title', 'messages', 'kind'] as const
const ENGINE_CONVERSATION_COLUMNS = ['id', 'title', 'engine_session_id', 'kind'] as const

type HubConversationRow = Pick<Database['public']['Tables']['foreman_conversations']['Row'], (typeof HUB_CONVERSATION_COLUMNS)[number]>
type EngineConversationRow = Pick<Database['public']['Tables']['sessions']['Row'], (typeof ENGINE_CONVERSATION_COLUMNS)[number]>

type ConversationUpdate = Database['public']['Tables']['foreman_conversations']['Update']
type ConversationInsert = Database['public']['Tables']['foreman_conversations']['Insert']
type SessionInsert = Database['public']['Tables']['sessions']['Insert']
type SessionUpdate = Database['public']['Tables']['sessions']['Update']

const UNIQUE_VIOLATION = '23505'

// The rows of the caller's conversations with the Chief of Staff of their workspace.
async function ownedBy(ctx: WorkspaceContext): Promise<{ agent_id: string; owner_user_id: string }> {
    return { agent_id: await ensureForemanAgentRow(createServiceRoleClient(), ctx.workspace.id), owner_user_id: ctx.userId }
}

// The builds of the app shipped before this move listen to `foreman_conversations` to know when to
// read the list again, and a hub rolled back to before it reads that table: every write to a
// conversation of the Chief of Staff is copied there, under the same id. Never thrown: the copy is a
// convenience for them, the conversation lives in `sessions`.
export async function copyToShippedForemanRow(sessionId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    try {
        const { data: session } = await selectMaybeSingleWithJoins(
            supabase,
            'sessions',
            ['id', 'owner_user_id', 'engine_session_id', 'kind', 'title', 'status', 'first_message', 'created_at', 'updated_at'] as const,
            { agent: { table: 'agents', foreignKey: 'agents!sessions_agent_id_fkey', columns: ['workspace_id', 'kind'] } } as const,
            { id: sessionId },
        )
        if (!session?.owner_user_id || session.agent?.kind !== 'foreman') return
        const copy = {
            engine_session_id: session.engine_session_id,
            kind: session.kind,
            title: session.kind === 'general' ? null : session.title,
            status: session.status,
            first_message: session.first_message,
            updated_at: session.updated_at,
        }
        const owner = { id: session.id, workspace_id: session.agent.workspace_id, user_id: session.owner_user_id }
        // The id comes from the client: a row of that id that is not this conversation's copy (someone
        // else's, or a conversation the hub kept) is never taken over.
        const inserted = await supabase
            .from('foreman_conversations')
            .upsert<ConversationInsert>({ ...owner, ...copy, backend: 'engine', created_at: session.created_at }, { onConflict: 'id', ignoreDuplicates: true })
        const { error } = inserted.error
            ? inserted
            : await supabase.from('foreman_conversations').update<ConversationUpdate>(copy).eq('id', owner.id).eq('workspace_id', owner.workspace_id).eq('user_id', owner.user_id).eq('backend', 'engine')
        if (error) console.error('[foreman] failed to copy the conversation for the shipped builds', error)
    } catch (err) {
        console.error('[foreman] failed to copy the conversation for the shipped builds', err)
    }
}

function firstUserText(messages: UIMessage[]): string {
    // The message that starts a guided setup was written by the app, not by the user: naming the
    // conversation after it would put the marker itself in the sidebar.
    const first = messages.find(message => message.role === 'user' && !message.parts.some(part => part.type === 'text' && isKickoffText((part as { text: string }).text)))
    if (!first) return ''
    // Un vocal porte son audio comme marqueur collé au transcript, et une pièce jointe sa liste de
    // chemins : la conversation est nommée d'après ce qui a été dit, pas d'après le fichier.
    return stripVoiceMarker(
        stripAttachmentsRef(
            first.parts
                .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                .map(part => part.text)
                .join(' ')
                .trim()
        )
    )
}

// Les tours écrits avant que la route ne nomme sa réponse ont été persistés avec un id vide, et
// deux d'entre eux dans la même conversation se rendent sous la même clé. Comblé à la lecture
// plutôt que par une migration : l'id ne sert qu'à la pile du navigateur, et sa position dans le
// transcript en fait une clé stable d'un rechargement à l'autre.
function withMessageIds(sessionId: string, messages: UIMessage[]): UIMessage[] {
    return messages.map((message, index) => (message.id ? message : { ...message, id: `${sessionId}-${index}` }))
}

// The conversation the column opens on. On the engine, this person's General, the one that never
// closes; on the hub, the onboarding's last, which never comes back once the engine has taken over.
// A workspace with no conversation yet gets none back: the client opens on an empty column and names
// the session itself.
export async function loadForemanConversation(ctx: WorkspaceContext, backend: ForemanBackend): Promise<ForemanConversation | null> {
    const supabase = createServiceRoleClient()
    if (backend === 'engine') {
        const { data } = await selectMaybeSingle(supabase, 'sessions', ENGINE_CONVERSATION_COLUMNS, { ...(await ownedBy(ctx)), kind: 'general' })
        return data ? readEngineConversation(ctx, data) : null
    }
    const { data } = await selectMany(supabase, 'foreman_conversations', HUB_CONVERSATION_COLUMNS, { workspace_id: ctx.workspace.id, user_id: ctx.userId, backend: 'hub' }, { column: 'updated_at', ascending: false }, 1)
    return data?.[0] ? readHubConversation(data[0]) : null
}

// One conversation of the caller, General or a thread, with what it takes to reopen it. Opening it is
// reading it: a thread a check-in left waiting for them stops waiting.
export async function loadForemanConversationById(ctx: WorkspaceContext, sessionId: string): Promise<ForemanConversation | null> {
    const supabase = createServiceRoleClient()
    const owner = await ownedBy(ctx)
    const { data } = await selectMaybeSingle(supabase, 'sessions', ENGINE_CONVERSATION_COLUMNS, { ...owner, id: sessionId })
    if (!data) {
        const { data: hub } = await selectMaybeSingle(supabase, 'foreman_conversations', HUB_CONVERSATION_COLUMNS, { id: sessionId, workspace_id: ctx.workspace.id, user_id: ctx.userId, backend: 'hub' })
        return hub ? readHubConversation(hub) : null
    }
    const { data: read, error } = await supabase.from('sessions').update<SessionUpdate>({ status: 'idle' }).eq('id', sessionId).eq('owner_user_id', ctx.userId).eq('status', 'awaiting_ack').select('id')
    if (error) console.error('[foreman] failed to mark the thread as read', error)
    else if (read?.length) await copyToShippedForemanRow(sessionId)
    return readEngineConversation(ctx, data)
}

async function readEngineConversation(ctx: WorkspaceContext, data: EngineConversationRow): Promise<ForemanConversation> {
    const base = { sessionId: data.id, title: data.kind === 'general' ? null : data.title, backend: 'engine' as const, kind: data.kind }
    const conn = await getWorkspaceConnection(ctx.workspace.id)
    // Each part fails on its own: a transcript with no gauge beats no transcript at all, and an
    // engine that predates the foreman's run routes, or its skills, answers 403 to the other reads.
    const [messages, runState, proposals] = await Promise.all([
        readEngineTranscript(conn, data.engine_session_id),
        readRunState(conn, data.engine_session_id).catch(() => NO_RUN_STATE),
        listSkillProposals(conn, FOREMAN_AGENT_ID, data.engine_session_id).catch(() => []),
    ])
    return { ...base, messages, proposals, ...runState }
}

function readHubConversation(data: HubConversationRow): ForemanConversation {
    return { sessionId: data.id, title: data.title, backend: 'hub', kind: data.kind, messages: withMessageIds(data.id, dedupeMessagesById((data.messages ?? []) as unknown as UIMessage[])), proposals: [], ...NO_RUN_STATE }
}

const LIST_COLUMNS = ['id', 'kind', 'title', 'status', 'first_message', 'engine_session_id', 'created_at', 'updated_at'] as const

// As many as a coworker's General shows.
const CONVERSATION_LIST_LIMIT = 200

type ListedRow = Pick<Database['public']['Tables']['sessions']['Row'], (typeof LIST_COLUMNS)[number]>

// The same shape as a coworker's conversations, so General draws its threads with the same parts on
// the web and in the app. Only what the column needs to tell them apart: no other agent opens a
// conversation of the foreman, and none of them is a routine's run.
export function foremanConversationOf(row: ListedRow): Conversation {
    return {
        id: row.id,
        agentId: FOREMAN_AGENT_ID,
        engineSessionId: row.engine_session_id,
        title: row.kind === 'general' ? GENERAL_SESSION_TITLE : row.title,
        status: row.status,
        source: 'dashboard',
        updatedAt: row.updated_at,
        originAgentId: null,
        originAgentName: null,
        automationName: null,
        outcome: null,
        kind: row.kind,
        createdAt: row.created_at,
        firstMessage: row.first_message,
    }
}

// General and its threads, the latest first: the onboarding's conversation, on the hub, is not one.
// `unseen`, as on a coworker's: a run finished in it since the caller last had it on screen.
export async function listForemanConversations(ctx: WorkspaceContext): Promise<Conversation[]> {
    const owner = await ownedBy(ctx)
    // `unseen_runs` answers for `auth.uid()`: it runs as the caller, not through the service role.
    const asCaller = await createClient()
    const [{ data }, unseen] = await Promise.all([
        selectMany(createServiceRoleClient(), 'sessions', LIST_COLUMNS, owner, { column: 'updated_at', ascending: false }, CONVERSATION_LIST_LIMIT),
        asCaller.rpc('unseen_runs', { p_workspace_id: ctx.workspace.id }),
    ])
    const unseenIds = unseen.error ? null : new Set((unseen.data ?? []).filter(run => run.agent_id === owner.agent_id).map(run => run.session_id))
    return (data ?? []).map(row => ({ ...foremanConversationOf(row), ...(unseenIds && { unseen: unseenIds.has(row.id) }) }))
}

async function readEngineTranscript(conn: EngineConnection, engineSessionId: string): Promise<UIMessage[]> {
    return transformEngineMessages(await getSessionMessages(conn, FOREMAN_AGENT_ID, engineSessionId)) as UIMessage[]
}

async function readRunState(conn: EngineConnection, engineSessionId: string): Promise<ForemanRunState> {
    const runs = await listSessionRuns(conn, FOREMAN_AGENT_ID, engineSessionId)
    const usage = runs.lastDone ? await readUsageSeed(conn, FOREMAN_AGENT_ID, runs.lastDone).catch(() => null) : null
    return { usage, lastError: lastRunError(runs.latest), activeRunId: runs.running?.id ?? null }
}

// The transcript of one engine conversation of the caller, for a column that needs to read it again
// once a run it was following is over.
export async function readForemanEngineMessages(ctx: WorkspaceContext, sessionId: string): Promise<UIMessage[]> {
    const session = await engineSessionOf(ctx, sessionId)
    if (session?.backend !== 'engine' || !session.engineSessionId) return []
    return readEngineTranscript(await getWorkspaceConnection(ctx.workspace.id), session.engineSessionId)
}

// Stop covers the whole conversation, not just the run this tab happens to be streaming: after a
// reload the column no longer holds the id of the run it is looking at.
export async function cancelForemanSessionRuns(ctx: WorkspaceContext, sessionId: string): Promise<void> {
    const session = await engineSessionOf(ctx, sessionId)
    if (session?.backend !== 'engine' || !session.engineSessionId) return
    const { engineSessionId } = session
    const conn = await getWorkspaceConnection(ctx.workspace.id)
    const runs = await listRuns(conn, FOREMAN_AGENT_ID, { sessionId: engineSessionId, status: 'running', limit: 200 })
    await Promise.all(runs.filter(run => run.sessionId === engineSessionId && run.status === 'running').map(run => cancelRun(conn, FOREMAN_AGENT_ID, run.id).catch(() => {})))
}

// The engine session a conversation continues, or null for one that has not started yet. A row that
// exists on the hub side cannot be continued on the engine: it answers 'hub'.
export async function engineSessionOf(ctx: WorkspaceContext, sessionId: string): Promise<{ backend: ForemanBackend; engineSessionId: string | null } | null> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'sessions', ['engine_session_id'] as const, { ...(await ownedBy(ctx)), id: sessionId })
    if (data) return { backend: 'engine', engineSessionId: data.engine_session_id }
    const { data: hub } = await selectMaybeSingle(supabase, 'foreman_conversations', ['id'] as const, { id: sessionId, workspace_id: ctx.workspace.id, user_id: ctx.userId, backend: 'hub' })
    return hub ? { backend: 'hub', engineSessionId: null } : null
}

// This person's General, once they have spoken in it.
export async function findForemanGeneral(ctx: WorkspaceContext): Promise<GeneralSession | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'sessions', ['id', 'engine_session_id'] as const, { ...(await ownedBy(ctx)), kind: 'general' })
    return data ? { id: data.id, engineSessionId: data.engine_session_id } : null
}

// Throws GeneralAlreadyOpenError when a General is inserted for a member who already has one: two
// tabs raced to open it, and the one that lost is told which row won so the message can start over there.
export async function startEngineConversation(ctx: WorkspaceContext, sessionId: string, engineSessionId: string, firstText: string, kind: SessionKind): Promise<void> {
    const supabase = createServiceRoleClient()
    const seed = stripVoiceMarker(stripAttachmentsRef(firstText)).trim()
    const { error } = await supabase.from('sessions').insert<SessionInsert>({
        id: sessionId,
        ...(await ownedBy(ctx)),
        engine_session_id: engineSessionId,
        kind,
        status: 'working',
        source: 'dashboard',
        title: kind === 'general' ? GENERAL_SESSION_TITLE : seedSessionTitle(seed),
        first_message: kind === 'general' ? null : seed.slice(0, FIRST_MESSAGE_MAX_CHARS) || null,
    })
    if (error) {
        if (kind === 'general' && error.code === UNIQUE_VIOLATION) {
            const general = await findForemanGeneral(ctx)
            if (general && general.id !== sessionId) throw new GeneralAlreadyOpenError(general)
        }
        throw new Error(error.message)
    }
    await copyToShippedForemanRow(sessionId)

    // General keeps its name; a thread is named after what it opens with, unless someone renamed it
    // first. Not awaited: the stream is waiting on this row, not on its title.
    if (kind === 'general' || !seed) return
    void generateSessionTitle(seed)
        .then(async title => {
            if (!title) return
            const { data } = await supabase.from('sessions').update<SessionUpdate>({ title }).eq('id', sessionId).eq('title', seedSessionTitle(seed)).select('id')
            if (data?.length) await copyToShippedForemanRow(sessionId)
        })
        .catch(() => {})
}

// Who reads what a routine of the foreman did: a member who follows it, as the one who scheduled it
// does, the longest-standing of them when several do, and the workspace's founder when nobody
// follows it.
async function routineReaderOf(workspaceId: number): Promise<string | null> {
    const supabase = createServiceRoleClient()
    const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId }, { column: 'created_at' })
    const idsByAge = (members ?? []).map(member => member.user_id)
    const { data: users } = idsByAge.length ? await selectMany(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: idsByAge }) : { data: [] }
    const followers = new Set((users ?? []).filter(user => coworkerRuleOf(normalizeNotificationPrefs(user.email_notification_prefs), FOREMAN_AGENT_ID).follow === true).map(user => user.id))
    return idsByAge.find(id => followers.has(id)) ?? (await workspaceFounderUserId(workspaceId))
}

// A routine of the foreman's own starts with nobody in front of it: its conversation becomes a
// thread of the member who reads it, so what it did shows in their General like any other thread.
// An engine session belongs to one row, so one member holds it. Never thrown: the engine's webhook
// is not the place to fail for a thread.
//
// A check-in that spoke names who it is for, already checked (`target`), and is opened waiting to be
// read: what its run said is a message for them. Hands back the thread it opened, null when it
// opened none, the engine telling it a second time included.
export type ForemanThreadTarget = { userId: string | null; status: SessionStatus }

export async function openForemanRoutineThread(workspaceId: number, engineSessionId: string, title: string, target?: ForemanThreadTarget, source: SessionSource = 'schedule'): Promise<{ id: string; userId: string } | null> {
    const supabase = createServiceRoleClient()
    try {
        const agentId = await ensureForemanAgentRow(supabase, workspaceId)
        const { data: existing } = await selectMaybeSingle(supabase, 'sessions', ['id'] as const, { agent_id: agentId, engine_session_id: engineSessionId })
        if (existing) return null
        const userId = target?.userId ?? (await routineReaderOf(workspaceId))
        if (!userId) return null
        const { data, error } = await supabase
            .from('sessions')
            .insert<SessionInsert>({ agent_id: agentId, owner_user_id: userId, engine_session_id: engineSessionId, kind: 'thread', status: target?.status ?? 'working', source, title: seedSessionTitle(title), automation_name: source === 'schedule' || source === 'trigger' ? title : null })
            .select('id')
            .single()
        if (error || !data) {
            if (error?.code !== UNIQUE_VIOLATION) console.error('[foreman] failed to open the thread of a routine', error)
            return null
        }
        await copyToShippedForemanRow(data.id)
        return { id: data.id, userId }
    } catch (err) {
        console.error('[foreman] failed to open the thread of a routine', err)
        return null
    }
}

// The engine announces a skill proposal as an approval once its run is over, and nothing answers it
// but the decision: without this the thread keeps asking for someone after Remember or No. It still
// waits when another proposal is open, or when the run stopped on a request, which leaves the same
// status.
export async function clearForemanSkillProposalAttention(conn: EngineConnection, sessionId: string, engineSessionId: string | null): Promise<void> {
    if (!engineSessionId) return
    const [proposals, messages] = await Promise.all([listSkillProposals(conn, FOREMAN_AGENT_ID, engineSessionId), readEngineTranscript(conn, engineSessionId)])
    if (openSkillProposal(proposals) || pendingRequestPeek(messages).pending) return
    const { data, error } = await createServiceRoleClient().from('sessions').update<SessionUpdate>({ status: 'idle' }).eq('id', sessionId).eq('status', 'awaiting_approval').select('id')
    if (error) console.error('[foreman] failed to clear the skill proposal attention', error)
    else if (data?.length) await copyToShippedForemanRow(sessionId)
}

// The caller's thread holding an engine conversation, when it is theirs to read.
export async function findForemanThreadId(ctx: WorkspaceContext, engineSessionId: string): Promise<string | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'sessions', ['id'] as const, { ...(await ownedBy(ctx)), engine_session_id: engineSessionId })
    return data?.id ?? null
}

export async function saveForemanConversation(ctx: WorkspaceContext, sessionId: string, messages: UIMessage[]): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: existing } = await selectMaybeSingle(supabase, 'foreman_conversations', ['id', 'title'] as const, { id: sessionId, workspace_id: ctx.workspace.id, user_id: ctx.userId })

    const payload = messages as unknown as ConversationUpdate['messages']

    if (!existing) {
        const { error } = await supabase.from('foreman_conversations').insert<ConversationInsert>({
            id: sessionId,
            workspace_id: ctx.workspace.id,
            user_id: ctx.userId,
            messages: payload,
        })
        // Two requests of the same conversation finishing together both find no row and both insert.
        // The later one writes over the earlier, scoped to its owner: the id comes from the browser.
        if (error?.code === UNIQUE_VIOLATION) {
            const { error: updateError } = await supabase
                .from('foreman_conversations')
                .update<ConversationUpdate>({ messages: payload, updated_at: new Date().toISOString() })
                .eq('id', sessionId)
                .eq('workspace_id', ctx.workspace.id)
                .eq('user_id', ctx.userId)
            if (updateError) throw new Error(updateError.message)
        } else if (error) throw new Error(error.message)
    } else {
        const { error } = await supabase
            .from('foreman_conversations')
            .update<ConversationUpdate>({ messages: payload, updated_at: new Date().toISOString() })
            .eq('id', sessionId)
        if (error) throw new Error(error.message)
    }

    if (existing?.title) return
    const seed = firstUserText(messages)
    if (!seed) return
    const title = await generateSessionTitle(seed).catch(() => null)
    if (!title) return
    await supabase.from('foreman_conversations').update<ConversationUpdate>({ title }).eq('id', sessionId)
}
