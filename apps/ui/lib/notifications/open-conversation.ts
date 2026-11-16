'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { markForemanConversationReadAction } from '@/app/api/_actions/foreman-conversation.actions'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { createClient } from '@/supabase/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type OpenConversationArgs = {
    agentId: string | null
    engineSessionId: string | null
    engineRunId: string | null
    /** `foreman` for a notification of the Chief of Staff, which has no coworker row. */
    engineAgentId?: string | null
}

// The Chief of Staff's own conversation, opened in its column. Its row is the reader's only, so a
// notification someone else cannot read opens nothing. What it was waiting to be read for is read.
export async function openForemanConversation(engineSessionId: string | null): Promise<void> {
    if (!engineSessionId) return
    const { data } = await selectMaybeSingle(createClient(), 'foreman_conversations', ['id', 'status'] as const, { engine_session_id: engineSessionId })
    if (!data) return
    useForemanStore.getState().openConversation(data.id)
    if (data.status === 'awaiting_ack') void markForemanConversationReadAction(data.id).catch(() => {})
}

// Opens the conversation tied to a notification: selects the agent and forces its panel onto the
// conversation tab, then, once the engine session id is resolved to the DB session id, drives the
// chat to the exact conversation. The tab is forced before the lookup so a notification without a
// resolvable session still lands on the chat rather than on whatever tab was left active.
export async function openConversationFromNotification({ agentId, engineSessionId, engineRunId, engineAgentId }: OpenConversationArgs): Promise<void> {
    if (agentId === FOREMAN_AGENT_ID || (!agentId && engineAgentId === FOREMAN_AGENT_ID)) return openForemanConversation(engineSessionId)
    if (!agentId) return

    useBoardStore.getState().openAgentChat(agentId)

    if (!engineSessionId) return

    const sessionId = await resolveSessionId(agentId, engineSessionId)
    if (!sessionId) return

    useBoardStore.getState().setPendingOpenSession({ agentId, sessionId, runId: engineRunId })
}

// A notification names its conversation by the engine's id; the hub tracks it by its own row.
export async function resolveSessionId(agentId: string, engineSessionId: string): Promise<string | null> {
    const { data } = await selectMaybeSingle(createClient(), 'sessions', ['id'] as const, {
        agent_id: agentId,
        engine_session_id: engineSessionId,
    })
    return data?.id ?? null
}
