import { buddyMoodOfStatus, type BuddyMood } from '@moldwright/ui/iso-grid'

import { useBoardStore } from '@/stores/board.store'

export function useAgentBuddyMood(agentId: string | null | undefined): BuddyMood {
    return useBoardStore(s => {
        const agent = agentId ? s.agents.find(a => a.id === agentId) : undefined
        return agent ? buddyMoodOfStatus(agent.status, !!agent.disabledAt) : 'idle'
    })
}
