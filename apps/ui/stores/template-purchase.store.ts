import { create } from 'zustand'

type TemplatePurchaseState = {
    version: number
    bumpVersion: () => void
}

export const useTemplatePurchaseStore = create<TemplatePurchaseState>(set => ({
    version: 0,
    bumpVersion: () => set(state => ({ version: state.version + 1 })),
}))
