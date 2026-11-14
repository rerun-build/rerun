'use client'

import { useEffect } from 'react'

import { useUnseenRunsStore } from '@/stores/unseen-runs.store'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

export function useUnseenRunsSync(workspaceId: number | undefined, userId: string | undefined) {
    useEffect(() => {
        if (workspaceId && userId) useUnseenRunsStore.getState().hydrate(workspaceId, userId)
    }, [workspaceId, userId])

    useEffect(() => {
        const refresh = () => void useUnseenRunsStore.getState().refresh()
        window.addEventListener('focus', refresh)
        return () => window.removeEventListener('focus', refresh)
    }, [])

    const refresh = () => void useUnseenRunsStore.getState().refresh()
    useRealtimeSubscription('session_reads', {
        channelId: `session-reads-${userId}`,
        filter: userId ? { column: 'user_id', value: userId } : undefined,
        enabled: !!userId && !!workspaceId,
        onInsert: refresh,
        onUpdate: refresh,
        onResync: refresh,
    })
}
