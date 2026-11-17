'use client'

import type { SessionStatus } from '@/lib/board/types'
import { useBoardStore } from '@/stores/board.store'
import { useCoworkerPreviewsStore } from '@/stores/coworker-previews.store'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

export function useSessionsRealtime(enabled: boolean) {
    const _onSessionInsert = useBoardStore(s => s._onSessionInsert)
    const _onSessionUpdate = useBoardStore(s => s._onSessionUpdate)
    const _onSessionDelete = useBoardStore(s => s._onSessionDelete)

    useRealtimeSubscription('sessions', {
        channelId: `sessions-status`,
        enabled,
        onResync: () => {
            void useBoardStore.getState().reconcileSessions()
            void useCoworkerPreviewsStore.getState().reload()
        },
        // A conversation with the Chief of Staff has an owner and is not the board's: its column
        // follows it on its own.
        onInsert: row => {
            if (row.owner_id) return
            useCoworkerPreviewsStore.getState().applySession(row)
            _onSessionInsert({
                id: row.id,
                agentId: row.agent_id,
                originAgentId: row.origin_agent_id,
                status: (row.status as SessionStatus) || 'idle',
            })
        },
        onUpdate: row => {
            if (row.owner_id) return
            useCoworkerPreviewsStore.getState().applySession(row)
            _onSessionUpdate({
                id: row.id,
                agentId: row.agent_id,
                originAgentId: row.origin_agent_id,
                status: (row.status as SessionStatus) || 'idle',
            })
        },
        onDelete: row => {
            if (row.id) _onSessionDelete(row.id)
        },
    })
}
