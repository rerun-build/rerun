'use client'

import { useCallback, useEffect, useRef } from 'react'

import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import type { AgentSchedule } from '@/lib/board/next-runs'
import { useBoardStore } from '@/stores/board.store'

// Nothing tells the board a schedule changed on the machine, so it also asks again on its own.
const POLL_INTERVAL = 5 * 60_000
// A run that starts or ends moves its schedule's last run a beat after the session row lands.
const RUN_SETTLE_MS = 1500

export function useAgentSchedulesSync(workspaceId: number | undefined) {
    const inFlight = useRef(false)
    // A change that lands while a load is under way may not be in its answer: it is asked again.
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

    // Whatever can move a schedule without the panel being involved: an agent writing one during a
    // run, a run firing, an agent switched on or off (which pauses and resumes its schedules).
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
    // Read through a ref: the workspace arriving gives `sync` a new identity, which the interval
    // above already answers with a read. Listed below, it asked for the same list again a beat later.
    const latestSync = useRef(sync)
    useEffect(() => {
        latestSync.current = sync
    }, [sync])

    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true
            return
        }
        const timer = setTimeout(() => void latestSync.current(), RUN_SETTLE_MS)
        return () => clearTimeout(timer)
    }, [workingSessions, switchedOff, refreshKey])
}
