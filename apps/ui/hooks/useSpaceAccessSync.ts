'use client'

import { useBoxViewer } from '@/hooks/useBoxAccess'
import { boxAccessFor } from '@/lib/board/box-access'
import { translated } from '@/lib/i18n/toast-text'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

// A Box opened to the caller, or a change of role or scope, brings Boxes and coworkers the board has
// never loaded: the board is read again. A grant taken away drops the Box on the spot, the same way
// the health poll does when RLS stops delivering a row the caller just lost sight of.
export function useSpaceAccessSync(workspaceId: number | undefined) {
    const { role, boxScope } = useSession()
    const viewer = useBoxViewer()
    const userId = viewer.userId ?? undefined
    // Then reframes: the Boxes that just opened can sit anywhere on the board. Not during a
    // placement, where the camera would move under the cursor.
    const rehydrate = useCallback(() => {
        if (!workspaceId) return
        void useBoardStore
            .getState()
            .hydrate(workspaceId)
            .then(() => {
                if (!useBoardStore.getState().placement) useBoardStore.setState(state => ({ recenterSignal: state.recenterSignal + 1 }))
            })
    }, [workspaceId])

    const revoke = useCallback(
        (row: { user_id: string; space_id: string }) => {
            if (!userId || row.user_id !== userId) return
            const { spaces, spaceGrants, setSpaceGrants, dropSpaces } = useBoardStore.getState()
            const space = spaces.find(candidate => candidate.id === row.space_id)
            // A grant replaced by the scope, or a Box never loaded: the board is read again.
            if (!space) {
                rehydrate()
                return
            }
            const remaining = spaceGrants.filter(grant => grant.space_id !== row.space_id || grant.user_id !== userId)
            if (boxAccessFor(viewer, space, remaining) === 'none') {
                if (dropSpaces([row.space_id])) toast(translated('errors.boxAccessLost'))
                return
            }
            setSpaceGrants(remaining)
        },
        [userId, viewer, rehydrate],
    )

    useRealtimeSubscription('space_members', {
        channelId: `space-members:${workspaceId}:${userId}`,
        enabled: !!workspaceId && !!userId,
        filter: userId ? { column: 'user_id', value: userId } : undefined,
        onInsert: rehydrate,
        onUpdate: rehydrate,
        onDelete: revoke,
    })

    const lastReach = useRef<string | null>(null)
    useEffect(() => {
        if (!workspaceId || !role) return
        const reach = `${workspaceId}:${role}:${boxScope}`
        const previous = lastReach.current
        lastReach.current = reach
        if (previous && previous !== reach && previous.startsWith(`${workspaceId}:`)) rehydrate()
    }, [workspaceId, role, boxScope, rehydrate])
}
