'use client'

import { useEffect, useState } from 'react'

import { useBoardStore } from '@/stores/board.store'

// How many coworkers' chats stay mounted behind the one on screen. Each keeps its whole transcript in
// the DOM and renders again with the board: without a ceiling, an hour of work stacks up a dozen.
export const KEEP_ALIVE_AGENTS = 3

// The chat of a coworker still answering owns the stream: it stays however old it is, and the oldest
// of the others goes instead.
export function trimOpenedAgents(ids: string[], busy: Set<string>): string[] {
    const kept = [...ids]
    for (let i = 0; kept.length > KEEP_ALIVE_AGENTS && i < kept.length - 1; ) {
        if (busy.has(kept[i])) i++
        else kept.splice(i, 1)
    }
    return kept
}

/**
 * The coworkers whose chat stays mounted, from the oldest to the one opened last: the selected one,
 * and the few seen before it, so going back to one keeps its stream and its scroll. A coworker deleted
 * since is dropped.
 */
export function useOpenedAgents(): string[] {
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const agents = useBoardStore(s => s.agents)
    const [openedAgentIds, setOpenedAgentIds] = useState<string[]>([])

    useEffect(() => {
        if (!selectedAgentId) return
        setOpenedAgentIds(prev => {
            if (prev[prev.length - 1] === selectedAgentId) return prev
            const busy = new Set(useBoardStore.getState().sessions.filter(s => s.status === 'working').map(s => s.agentId))
            return trimOpenedAgents([...prev.filter(id => id !== selectedAgentId), selectedAgentId], busy)
        })
    }, [selectedAgentId])

    useEffect(() => {
        const agentIds = new Set(agents.map(a => a.id))
        setOpenedAgentIds(prev => {
            const filtered = prev.filter(id => agentIds.has(id))
            return filtered.length === prev.length ? prev : filtered
        })
    }, [agents])

    return openedAgentIds
}
