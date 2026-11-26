'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'

import { findForemanThreadAction } from '@/app/api/_actions/foreman-conversation.actions'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { createClient } from '@/supabase/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type OpenConversationArgs = {
    agentId: string | null
    engineAgentId?: string | null
    engineSessionId: string | null
    engineRunId: string | null
    // A script routine's run has no conversation: its notification opens the routine instead.
    scriptSlug?: string | null
}

// The Chief of Staff sits on no board: its notification names it by its engine id, and the
// conversation it is about is one of the reader's threads in its column.
async function openForemanThread(engineSessionId: string | null): Promise<void> {
    const store = useForemanStore.getState()
    store.setTab('assistant')
    const threadId = engineSessionId ? await findForemanThreadAction(engineSessionId) : null
    if (threadId) store.openThread(threadId)
}

// Opens the conversation tied to a notification: selects the agent and forces its panel onto the
// conversation tab, then, once the engine session id is resolved to the DB session id, drives the
// chat to the exact conversation. The tab is forced before the lookup so a notification without a
// resolvable session still lands on the chat rather than on whatever tab was left active.
export async function openConversationFromNotification({ agentId, engineAgentId, engineSessionId, engineRunId, scriptSlug }: OpenConversationArgs): Promise<void> {
    if (engineAgentId === FOREMAN_AGENT_ID) return openForemanThread(engineSessionId)
    if (!agentId) return
    if (!engineSessionId && scriptSlug) return useBoardStore.getState().openAgentSchedule(agentId, scriptSlug)

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
