import { create } from 'zustand'

export type CreatorPane = { kind: 'empty' } | { kind: 'template'; id: string } | { kind: 'payouts' } | { kind: 'revenue' }

type CreatorState = {
    open: boolean
    pane: CreatorPane
    createOpen: boolean
    connectRefresh: boolean
    openCreator: (pane?: CreatorPane) => void
    setPane: (pane: CreatorPane) => void
    setOpen: (open: boolean) => void
    setCreateOpen: (open: boolean) => void
    setConnectRefresh: (value: boolean) => void
}

export const useCreatorStore = create<CreatorState>(set => ({
    open: false,
    pane: { kind: 'empty' },
    createOpen: false,
    connectRefresh: false,
    openCreator: pane => set({ open: true, pane: pane ?? { kind: 'empty' } }),
    setPane: pane => set({ pane }),
    setOpen: open => set(open ? { open } : { open: false, pane: { kind: 'empty' }, connectRefresh: false }),
    setCreateOpen: createOpen => set({ createOpen }),
    setConnectRefresh: connectRefresh => set({ connectRefresh }),
}))
