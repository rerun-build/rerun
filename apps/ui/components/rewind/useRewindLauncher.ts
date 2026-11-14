'use client'

import { useEffect, useRef } from 'react'

import { listRewindsAction } from '@/app/api/_actions/rewind.actions'
import { weekEndOf } from '@/lib/rewind/week'
import { useRewindStore } from '@/stores/rewind.store'

const DAY_MS = 24 * 60 * 60 * 1000
const AUTO_OPEN_WINDOW_MS = 7 * DAY_MS

export function useRewindLauncher(workspaceId: number | undefined, ready: boolean, deepLinked: boolean) {
    const handledWorkspace = useRef<number | null>(null)
    const pendingDeepLink = useRef(false)

    useEffect(() => {
        if (deepLinked) pendingDeepLink.current = true
    }, [deepLinked])

    useEffect(() => {
        if (!workspaceId || !ready || handledWorkspace.current === workspaceId) return
        handledWorkspace.current = workspaceId
        useRewindStore.getState().setWeeks([])

        void listRewindsAction()
            .then(weeks => {
                if (handledWorkspace.current !== workspaceId) return
                const store = useRewindStore.getState()
                store.setWeeks(weeks)
                const latest = weeks[0]
                if (!latest) return
                const fresh = Date.now() - Date.parse(weekEndOf(latest.weekStart)) < AUTO_OPEN_WINDOW_MS
                if (pendingDeepLink.current || (!latest.viewed && fresh)) store.openLatest()
                pendingDeepLink.current = false
            })
            .catch(() => undefined)
    }, [workspaceId, ready])
}
