'use client'

import { useCallback, useEffect, useRef } from 'react'

import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import type { AgentSchedule } from '@/lib/board/next-runs'
import { useBoardStore } from '@/stores/board.store'

const POLL_INTERVAL = 5 * 60_000
const RUN_SETTLE_MS = 1500

export function useAgentSchedulesSync(workspaceId: number | undefined) {
    const inFlight = useRef(false)
    const stale = useRef(false)

    const sync = useCallback(async () => {
        if (!workspaceId) return
        if (inFlight.current) {
            stale.current = true
            return
        }
        inFlight.current = true
        try {
            do {
                stale.current = false
                const res = await fetch('/api/agents/schedules', { cache: 'no-store' })
                if (!res.ok) return
                useBoardStore.getState().setAgentSchedules((await res.json()) as AgentSchedule[])
            } while (stale.current)
        } catch {
        } finally {
            inFlight.current = false
        }
    }, [workspaceId])

    useVisibleInterval(sync, POLL_INTERVAL)

    const workingSessions = useBoardStore(state =>
        state.sessions
            .filter(session => session.status === 'working')
            .map(session => session.id)
            .sort()
            .join(',')
    )
    const switchedOff = useBoardStore(state =>
        state.agents
            .filter(agent => agent.disabledAt)
            .map(agent => agent.id)
            .sort()
            .join(',')
    )
    const refreshKey = useBoardStore(state => state.schedulesRefreshKey)
    const mounted = useRef(false)

    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true
            return
        }
        const timer = setTimeout(sync, RUN_SETTLE_MS)
        return () => clearTimeout(timer)
    }, [sync, workingSessions, switchedOff, refreshKey])
}
