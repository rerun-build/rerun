import { create } from 'zustand'
import type { AgentSharePreview } from '@rerun/contracts'

type AgentShareFlowState = {
    token: string | null
    preview: AgentSharePreview | null
    openLink: (token: string) => void
    resolveLink: (preview: AgentSharePreview) => void
    closeLink: () => void
}

export const useAgentShareStore = create<AgentShareFlowState>()(set => ({
    token: null,
    preview: null,
    openLink: token => set(state => ({ token, preview: state.token === token ? state.preview : null })),
    resolveLink: preview => set({ preview }),
    closeLink: () => set({ token: null, preview: null }),
}))

export function isAgentShareFlowBusy(state: Pick<AgentShareFlowState, 'token'>): boolean {
    return !!state.token
}
