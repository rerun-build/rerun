import type { TakeoverResult } from '@moldwright/contracts'
import { create } from 'zustand'

export type TakeoverTarget = { agentId: string; url: string; reason: string; callId: string }

type DesktopState = {
    agentId: string | null
    takeover: TakeoverTarget | null
    handedBack: Record<string, TakeoverResult>
    openDesktop: (agentId: string) => void
    openTakeover: (target: TakeoverTarget) => void
    handBack: (callId: string, result: TakeoverResult) => void
    close: () => void
}

export const useDesktopStore = create<DesktopState>(set => ({
    agentId: null,
    takeover: null,
    handedBack: {},
    openDesktop: agentId => set({ agentId, takeover: null }),
    openTakeover: target => set({ agentId: target.agentId, takeover: target }),
    handBack: (callId, result) => set(state => ({ agentId: null, takeover: null, handedBack: { ...state.handedBack, [callId]: result } })),
    close: () => set({ agentId: null, takeover: null }),
}))
