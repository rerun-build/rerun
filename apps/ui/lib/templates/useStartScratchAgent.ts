'use client'

import { useBoardStore } from '@/stores/board.store'
import { track } from '@rerun/analytics/client'

export type ScratchAgent = { name: string; serviceSlugs: string[]; kickoff: string; suggestionId: string | null }

export function useStartScratchAgent() {
    const beginAgentPlacement = useBoardStore(s => s.beginAgentPlacement)
    const isFirstAgent = useBoardStore(s => s.spaces.length === 0)

    return ({ name, serviceSlugs, kickoff, suggestionId }: ScratchAgent, spaceId: string | null = null) => {
        beginAgentPlacement({ name: name.trim(), serviceSlugs, kickoff }, spaceId)
        if (isFirstAgent) track('first_agent_created', { template: suggestionId ? `suggestion:${suggestionId}` : 'scratch' })
    }
}
