import 'server-only'

import { FOREMAN_AGENT_ID, type Conversation, type SessionKind, type SessionStatus } from '@rerun/contracts'
import type { UIMessage } from 'ai'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { FIRST_MESSAGE_MAX_CHARS, GENERAL_SESSION_TITLE, lastRunError, listSessionRuns, readUsageSeed, type SessionUsageSeed } from '@/app/api/_services/chat.service'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import { generateSessionTitle } from '@/lib/ai/generate-title'
import { seedSessionTitle } from '@/lib/chat/session-title'
import { transformEngineMessages } from '@/lib/chat/engine-history'
import { cancelRun, getSessionMessages, listRuns } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import type { ForemanBackend } from './phase'
import { stripAttachmentsRef } from '@/lib/chat/attachments-marker'
import { dedupeMessagesById } from '@/lib/foreman/dedupe-messages'
import { isKickoffText } from '@/lib/foreman/kickoff-marker'
import { stripVoiceMarker } from '@/lib/voice/marker'
import { foremanAgentId } from './agent-row'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

// An engine conversation is a row of `sessions`, like a coworker's, on the Chief of Staff's row of
// `agents`, owned by the member who has it: everyone talks to the same Chief of Staff with their own
// rights, so each keeps their own General and threads. Its transcript stays on the engine.
//
// A hub conversation, the onboarding's, stays in `foreman_conversations`: rewritten whole at the end
// of each turn, since onFinish hands back the updated UIMessage list and replacing it is both simpler
// and more faithful than diffing parts that the SDK may have merged.

// What only an engine conversation has: its runs live on the engine, so the gauge, the failure of a
// run that died without answering and the run still in flight are read back with the transcript.
export type ForemanRunState = { usage: SessionUsageSeed | null; lastError: string | null; activeRunId: string | null }

export type ForemanConversation = { sessionId: string; title: string | null; backend: ForemanBackend; kind: SessionKind; messages: UIMessage[] } & ForemanRunState

const NO_RUN_STATE: ForemanRunState = { usage: null, lastError: null, activeRunId: null }

const HUB_CONVERSATION_COLUMNS = ['id', 'title', 'messages', 'kind'] as const
const ENGINE_CONVERSATION_COLUMNS = ['id', 'title', 'engine_session_id', 'kind'] as const

type HubConversationRow = Pick<Database['public']['Tables']['foreman_conversations']['Row'], (typeof HUB_CONVERSATION_COLUMNS)[number]>
type EngineConversationRow = Pick<Database['public']['Tables']['sessions']['Row'], (typeof ENGINE_CONVERSATION_COLUMNS)[number]>

type ConversationUpdate = Database['public']['Tables']['foreman_conversations']['Update']
type ConversationInsert = Database['public']['Tables']['foreman_conversations']['Insert']
type SessionInsert = Database['public']['Tables']['sessions']['Insert']
type SessionUpdate = Database['public']['Tables']['sessions']['Update']

// The member's conversations with the Chief of Staff of their workspace.
async function ownedBy(ctx: WorkspaceContext): Promise<{ agent_id: string; owner_id: string }> {
    return { agent_id: await foremanAgentId(ctx.workspace.id), owner_id: ctx.userId }
}

const UNIQUE_VIOLATION = '23505'

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

// One conversation of the caller, General or a thread, with what it takes to reopen it.
export async function loadForemanConversationById(ctx: WorkspaceContext, sessionId: string): Promise<ForemanConversation | null> {
    const supabase = createServiceRoleClient()
    const { data: session } = await selectMaybeSingle(supabase, 'sessions', ENGINE_CONVERSATION_COLUMNS, { id: sessionId, ...(await ownedBy(ctx)) })
    if (session) return readEngineConversation(ctx, session)
    const { data: hub } = await selectMaybeSingle(supabase, 'foreman_conversations', HUB_CONVERSATION_COLUMNS, { id: sessionId, workspace_id: ctx.workspace.id, user_id: ctx.userId, backend: 'hub' })
    return hub ? readHubConversation(hub) : null
}

async function readEngineConversation(ctx: WorkspaceContext, data: EngineConversationRow): Promise<ForemanConversation> {
    // General is named by the clients, which show their own words while it has no title of its own.
    const base = { sessionId: data.id, title: data.kind === 'general' ? null : data.title, backend: 'engine' as const, kind: data.kind }
    const conn = await getWorkspaceConnection(ctx.workspace.id)
    // Each part fails on its own: a transcript with no gauge beats no transcript at all, and an
    // engine that predates the foreman's run routes answers 403 to the second read.
    const [messages, runState] = await Promise.all([readEngineTranscript(conn, data.engine_session_id), readRunState(conn, data.engine_session_id).catch(() => NO_RUN_STATE)])
    return { ...base, messages, ...runState }
}

function readHubConversation(data: HubConversationRow): ForemanConversation {
    return { sessionId: data.id, title: data.title, backend: 'hub', kind: data.kind, messages: withMessageIds(data.id, dedupeMessagesById((data.messages ?? []) as unknown as UIMessage[])), ...NO_RUN_STATE }
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
export async function listForemanConversations(ctx: WorkspaceContext): Promise<Conversation[]> {
    const { data } = await selectMany(createServiceRoleClient(), 'sessions', LIST_COLUMNS, await ownedBy(ctx), { column: 'updated_at', ascending: false }, CONVERSATION_LIST_LIMIT)
    return (data ?? []).map(foremanConversationOf)
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
    const { data: session } = await selectMaybeSingle(supabase, 'sessions', ['engine_session_id'] as const, { id: sessionId, ...(await ownedBy(ctx)) })
    if (session) return { backend: 'engine', engineSessionId: session.engine_session_id }
    const { data: hub } = await selectMaybeSingle(supabase, 'foreman_conversations', ['id'] as const, { id: sessionId, workspace_id: ctx.workspace.id, user_id: ctx.userId, backend: 'hub' })
    return hub ? { backend: 'hub', engineSessionId: null } : null
}

type ForemanGeneral = { id: string; engineSessionId: string | null }

// This person's General, once they have spoken in it.
export async function findForemanGeneral(ctx: WorkspaceContext): Promise<ForemanGeneral | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'sessions', ['id', 'engine_session_id'] as const, { ...(await ownedBy(ctx)), kind: 'general' })
    return data ? { id: data.id, engineSessionId: data.engine_session_id } : null
}

// Thrown when a General is inserted for a member who already has one: two tabs raced to open it, and
// the one that lost is told which row won so the message can start over there.
export class ForemanGeneralAlreadyOpenError extends Error {
    constructor(readonly general: ForemanGeneral) {
        super('General already open')
    }
}

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
            if (general && general.id !== sessionId) throw new ForemanGeneralAlreadyOpenError(general)
        }
        throw new Error(error.message)
    }

    // General keeps its name; a thread is named after what it opens with. Not awaited: the stream is
    // waiting on this row, not on its title.
    if (kind === 'general' || !seed) return
    void generateSessionTitle(seed)
        .then(async title => {
            if (title) await supabase.from('sessions').update<SessionUpdate>({ title }).eq('id', sessionId)
        })
        .catch(() => {})
}

// What the list of conversations sorts on, so it has to move on every turn.
export async function touchForemanConversation(sessionId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    await supabase.from('sessions').update<SessionUpdate>({ updated_at: new Date().toISOString(), status: 'working' }).eq('id', sessionId).not('owner_id', 'is', null)
}

// Where a run of the foreman stopped, as its thread shows it in General. The engine names the session
// and the workspace it reports for, not the member: an engine session belongs to one row only.
export async function setForemanConversationStatus(workspaceId: number, engineSessionId: string, status: SessionStatus): Promise<void> {
    const supabase = createServiceRoleClient()
    let query = supabase.from('sessions').update<SessionUpdate>({ status }).eq('agent_id', await foremanAgentId(workspaceId)).eq('engine_session_id', engineSessionId)
    // Same guard as a coworker's: the `done` that follows an `info` notification must not clear the
    // acknowledgement it asked for.
    if (status === 'idle') query = query.neq('status', 'awaiting_ack')
    // Never thrown: the engine's webhook is not the place to fail for a dot in the column.
    try {
        const { error } = await query
        if (error) console.error('[foreman] failed to update the conversation status', error)
    } catch (err) {
        console.error('[foreman] failed to update the conversation status', err)
    }
}

export async function saveForemanConversation(ctx: WorkspaceContext, sessionId: string, messages: UIMessage[]): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: existing } = await selectMaybeSingle(supabase, 'foreman_conversations', ['id', 'title'] as const, { id: sessionId, workspace_id: ctx.workspace.id, user_id: ctx.userId, backend: 'hub' })

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
