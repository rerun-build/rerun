'use client'

import { useBoardStore } from '@/stores/board.store'
import { createClient } from '@/supabase/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type OpenConversationArgs = {
    agentId: string | null
    engineSessionId: string | null
    engineRunId: string | null
}

// Opens the conversation tied to a notification: selects the agent and forces its panel onto the
// conversation tab, then, once the engine session id is resolved to the DB session id, drives the
// chat to the exact conversation. The tab is forced before the lookup so a notification without a
// resolvable session still lands on the chat rather than on whatever tab was left active.
export async function openConversationFromNotification({ agentId, engineSessionId, engineRunId }: OpenConversationArgs): Promise<void> {
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
