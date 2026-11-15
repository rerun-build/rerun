import 'server-only'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import type { UIMessage } from 'ai'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { lastRunError, listSessionRuns, readUsageSeed, type SessionUsageSeed } from '@/app/api/_services/chat.service'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import { generateSessionTitle } from '@/lib/ai/generate-title'
import { transformEngineMessages } from '@/lib/chat/engine-history'
import { cancelRun, getSessionMessages, listRuns } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import type { ForemanBackend } from './phase'
import { stripAttachmentsRef } from '@/lib/chat/attachments-marker'
import { dedupeMessagesById } from '@/lib/foreman/dedupe-messages'
import { isKickoffText } from '@/lib/foreman/kickoff-marker'
import { stripVoiceMarker } from '@/lib/voice/marker'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

export type ForemanRunState = { usage: SessionUsageSeed | null; lastError: string | null; activeRunId: string | null }

export type ForemanConversation = { sessionId: string; title: string | null; backend: ForemanBackend; messages: UIMessage[] } & ForemanRunState

const NO_RUN_STATE: ForemanRunState = { usage: null, lastError: null, activeRunId: null }

const CONVERSATION_COLUMNS = ['id', 'title', 'messages', 'backend', 'engine_session_id'] as const

type ConversationUpdate = Database['public']['Tables']['foreman_conversations']['Update']
type ConversationInsert = Database['public']['Tables']['foreman_conversations']['Insert']

const UNIQUE_VIOLATION = '23505'

function firstUserText(messages: UIMessage[]): string {
    const first = messages.find(message => message.role === 'user' && !message.parts.some(part => part.type === 'text' && isKickoffText((part as { text: string }).text)))
    if (!first) return ''
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

function withMessageIds(sessionId: string, messages: UIMessage[]): UIMessage[] {
    return messages.map((message, index) => (message.id ? message : { ...message, id: `${sessionId}-${index}` }))
}

export async function loadForemanConversation(ctx: WorkspaceContext, backend: ForemanBackend): Promise<ForemanConversation | null> {
    const supabase = createServiceRoleClient()
    const { data: rows } = await selectMany(supabase, 'foreman_conversations', CONVERSATION_COLUMNS, { workspace_id: ctx.workspace.id, user_id: ctx.userId, backend }, { column: 'updated_at', ascending: false }, 1)
    const data = rows?.[0]
    if (!data) return null

    if (backend === 'engine') {
        if (!data.engine_session_id) return { sessionId: data.id, title: data.title, backend, messages: [], ...NO_RUN_STATE }
        const conn = await getWorkspaceConnection(ctx.workspace.id)
        const [messages, runState] = await Promise.all([readEngineTranscript(conn, data.engine_session_id), readRunState(conn, data.engine_session_id).catch(() => NO_RUN_STATE)])
        return { sessionId: data.id, title: data.title, backend, messages, ...runState }
    }
    return { sessionId: data.id, title: data.title, backend, messages: withMessageIds(data.id, dedupeMessagesById((data.messages ?? []) as unknown as UIMessage[])), ...NO_RUN_STATE }
}

async function readEngineTranscript(conn: EngineConnection, engineSessionId: string): Promise<UIMessage[]> {
    return transformEngineMessages(await getSessionMessages(conn, FOREMAN_AGENT_ID, engineSessionId)) as UIMessage[]
}

async function readRunState(conn: EngineConnection, engineSessionId: string): Promise<ForemanRunState> {
    const runs = await listSessionRuns(conn, FOREMAN_AGENT_ID, engineSessionId)
    const usage = runs.lastDone ? await readUsageSeed(conn, FOREMAN_AGENT_ID, runs.lastDone).catch(() => null) : null
    return { usage, lastError: lastRunError(runs.latest), activeRunId: runs.running?.id ?? null }
}

export async function readForemanEngineMessages(ctx: WorkspaceContext, sessionId: string): Promise<UIMessage[]> {
    const session = await engineSessionOf(ctx, sessionId)
    if (session?.backend !== 'engine' || !session.engineSessionId) return []
    return readEngineTranscript(await getWorkspaceConnection(ctx.workspace.id), session.engineSessionId)
}

export async function cancelForemanSessionRuns(ctx: WorkspaceContext, sessionId: string): Promise<void> {
    const session = await engineSessionOf(ctx, sessionId)
    if (session?.backend !== 'engine' || !session.engineSessionId) return
    const { engineSessionId } = session
    const conn = await getWorkspaceConnection(ctx.workspace.id)
    const runs = await listRuns(conn, FOREMAN_AGENT_ID, { sessionId: engineSessionId, status: 'running', limit: 200 })
    await Promise.all(runs.filter(run => run.sessionId === engineSessionId && run.status === 'running').map(run => cancelRun(conn, FOREMAN_AGENT_ID, run.id).catch(() => {})))
}

export async function engineSessionOf(ctx: WorkspaceContext, sessionId: string): Promise<{ backend: ForemanBackend; engineSessionId: string | null } | null> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'foreman_conversations', ['backend', 'engine_session_id'] as const, { id: sessionId, workspace_id: ctx.workspace.id, user_id: ctx.userId })
    if (!data) return null
    return { backend: data.backend === 'engine' ? 'engine' : 'hub', engineSessionId: data.engine_session_id }
}

export async function startEngineConversation(ctx: WorkspaceContext, sessionId: string, engineSessionId: string, firstText: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('foreman_conversations').insert<ConversationInsert>({
        id: sessionId,
        workspace_id: ctx.workspace.id,
        user_id: ctx.userId,
        backend: 'engine',
        engine_session_id: engineSessionId,
    })
    if (error) throw new Error(error.message)

    const seed = stripVoiceMarker(stripAttachmentsRef(firstText)).trim()
    if (!seed) return
    void generateSessionTitle(seed)
        .then(async title => {
            if (title) await supabase.from('foreman_conversations').update<ConversationUpdate>({ title }).eq('id', sessionId)
        })
        .catch(() => {})
}

export async function touchForemanConversation(sessionId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    await supabase.from('foreman_conversations').update<ConversationUpdate>({ updated_at: new Date().toISOString() }).eq('id', sessionId)
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
