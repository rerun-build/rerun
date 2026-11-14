import { create } from 'zustand'
import { countBrainProposalsAction } from '@/app/api/_actions/brain.actions'

type BrainState = {
    openProposals: number
    version: number
    refreshProposalCount: () => Promise<void>
    setOpenProposals: (count: number) => void
    brainChanged: () => void
}

const COALESCE_MS = 300
let pendingChange: ReturnType<typeof setTimeout> | null = null

export const useBrainStore = create<BrainState>((set, get) => ({
    openProposals: 0,
    version: 0,
    refreshProposalCount: async () => set({ openProposals: await countBrainProposalsAction() }),
    setOpenProposals: openProposals => set({ openProposals }),
    brainChanged: () => {
        if (pendingChange) clearTimeout(pendingChange)
        pendingChange = setTimeout(() => {
            pendingChange = null
            set(state => ({ version: state.version + 1 }))
            get().refreshProposalCount().catch(() => {})
        }, COALESCE_MS)
    },
}))
