'use client'

import { useBoardStore } from '@/stores/board.store'
import { createClient } from '@/supabase/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type OpenConversationArgs = {
    agentId: string | null
    engineSessionId: string | null
    engineRunId: string | null
}

export async function openConversationFromNotification({ agentId, engineSessionId, engineRunId }: OpenConversationArgs): Promise<void> {
    if (!agentId) return

    useBoardStore.getState().openAgentChat(agentId)

    if (!engineSessionId) return

    const { data } = await selectMaybeSingle(createClient(), 'sessions', ['id'] as const, {
        agent_id: agentId,
        engine_session_id: engineSessionId,
    })
    if (!data) return

    useBoardStore.getState().setPendingOpenSession({ agentId, sessionId: data.id, runId: engineRunId })
}
