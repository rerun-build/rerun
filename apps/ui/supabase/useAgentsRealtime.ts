'use client'

import { agentFromRow } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'
import { sitsInABox } from '@/lib/agents/in-box'

export function useAgentsRealtime(workspaceId: number | undefined) {
    useRealtimeSubscription('agents', {
        channelId: `agents-ws-${workspaceId}`,
        filter: workspaceId ? { column: 'workspace_id', value: workspaceId } : undefined,
        enabled: !!workspaceId,
        onInsert: row => {
            if (sitsInABox(row)) useBoardStore.getState()._onAgentInsert(agentFromRow(row))
        },
        onUpdate: row => {
            if (sitsInABox(row)) useBoardStore.getState()._onAgentUpdate(agentFromRow(row))
        },
        onDelete: row => {
            useBoardStore.getState()._onAgentDelete(row.id)
        },
    })
}
