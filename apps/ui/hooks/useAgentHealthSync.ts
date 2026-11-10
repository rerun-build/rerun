'use client'

import type { AgentHealthResult } from '@/app/api/_services/gateway.service'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { translated } from '@/lib/i18n/toast-text'
import { useBoardStore } from '@/stores/board.store'
import { useCallback, useRef } from 'react'
import { toast } from 'sonner'

const POLL_INTERVAL = 10_000
const GRACE_IDLE = 2
const GRACE_WORKING = 5
// A Box absent from the caller's reach this many polls in a row leaves the board: one miss can be a
// Box created a moment ago that the health read did not see yet.
const SPACE_GONE_STRIKES = 2

export function useAgentHealthSync(workspaceId: number | undefined) {
    const offlineStrikes = useRef<Record<string, number>>({})
    const missingSpaceStrikes = useRef<Record<string, number>>({})
    // Un check plus long que l'intervalle ne doit pas en lancer un second par-dessus.
    const inFlight = useRef(false)

    const sync = useCallback(async () => {
        if (!workspaceId || inFlight.current) return
        inFlight.current = true
        try {
            const res = await fetch('/api/agents/health', { cache: 'no-store' })
            if (!res.ok) return
            const { statuses, links, spaceIds } = (await res.json()) as AgentHealthResult
            const { agents, agentOnlineMap, agentEngineBusyMap, setAgentOnline, setAgentEngineBusy, setLiveLinks } = useBoardStore.getState()

            setLiveLinks(links)
            if (Array.isArray(spaceIds)) dropUnreachableSpaces(new Set(spaceIds), missingSpaceStrikes.current)

            for (const agent of agents) {
                const health = statuses[agent.id]
                if (!health) continue

                const unreachable = health === 'offline'
                const wasWorking = agentEngineBusyMap[agent.id] ?? false
                const grace = wasWorking ? GRACE_WORKING : GRACE_IDLE
                const currentlyOnline = agentOnlineMap[agent.id] ?? true

                if (unreachable) {
                    const strikes = (offlineStrikes.current[agent.id] ?? 0) + 1
                    offlineStrikes.current[agent.id] = strikes
                    const shouldBeOnline = strikes < grace
                    if (currentlyOnline !== shouldBeOnline) setAgentOnline(agent.id, shouldBeOnline)
                    continue
                }

                offlineStrikes.current[agent.id] = 0
                if (!currentlyOnline) setAgentOnline(agent.id, true)

                const currentlyBusy = agentEngineBusyMap[agent.id] ?? false
                const shouldBeBusy = health === 'working'
                if (currentlyBusy !== shouldBeBusy) setAgentEngineBusy(agent.id, shouldBeBusy)
            }
        } catch {
        } finally {
            inFlight.current = false
        }
    }, [workspaceId])

    useVisibleInterval(sync, POLL_INTERVAL)
}

function dropUnreachableSpaces(reachable: Set<string>, strikes: Record<string, number>) {
    const { spaces, dropSpaces } = useBoardStore.getState()
    const gone: string[] = []
    for (const space of spaces) {
        if (reachable.has(space.id)) {
            delete strikes[space.id]
            continue
        }
        strikes[space.id] = (strikes[space.id] ?? 0) + 1
        if (strikes[space.id] >= SPACE_GONE_STRIKES) gone.push(space.id)
    }
    if (!gone.length) return
    for (const id of gone) delete strikes[id]
    if (dropSpaces(gone)) toast(translated('errors.boxAccessLost'))
}
