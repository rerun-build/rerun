import { pushRecentAgent } from '@/lib/control-center/commands'
import { create } from 'zustand'

const RECENT_AGENTS_KEY = 'control-center-recent-agents'

function readRecentAgents(): string[] {
    if (typeof window === 'undefined') return []
    try {
        const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_AGENTS_KEY) ?? '[]')
        return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
    } catch {
        return []
    }
}

type ControlCenterState = {
    open: boolean
    recentAgentIds: string[]
    setOpen: (open: boolean) => void
    openControlCenter: () => void
    rememberAgent: (agentId: string) => void
}

export const useControlCenterStore = create<ControlCenterState>((set, get) => ({
    open: false,
    recentAgentIds: readRecentAgents(),
    setOpen: open => set({ open }),
    openControlCenter: () => get().setOpen(true),
    rememberAgent: agentId => {
        const recentAgentIds = pushRecentAgent(get().recentAgentIds, agentId)
        set({ recentAgentIds })
        try {
            window.localStorage.setItem(RECENT_AGENTS_KEY, JSON.stringify(recentAgentIds))
        } catch {
        }
    },
}))
