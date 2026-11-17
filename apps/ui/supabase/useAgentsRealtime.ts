'use client'

import { agentFromRow, isInABox } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

export function useAgentsRealtime(workspaceId: number | undefined) {
    useRealtimeSubscription('agents', {
        channelId: `agents-ws-${workspaceId}`,
        filter: workspaceId ? { column: 'workspace_id', value: workspaceId } : undefined,
        enabled: !!workspaceId,
        onInsert: row => {
            if (isInABox(row)) useBoardStore.getState()._onAgentInsert(agentFromRow(row))
        },
        onUpdate: row => {
            if (isInABox(row)) useBoardStore.getState()._onAgentUpdate(agentFromRow(row))
        },
        onDelete: row => {
            useBoardStore.getState()._onAgentDelete(row.id)
        },
    })
}
