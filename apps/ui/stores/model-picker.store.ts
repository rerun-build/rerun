import { create } from 'zustand'

type ModelPickerState = {
    openFor: string | null
    request: (pickerKey: string) => void
    consume: () => void
}

export const useModelPickerStore = create<ModelPickerState>(set => ({
    openFor: null,
    request: pickerKey => set({ openFor: pickerKey }),
    consume: () => set({ openFor: null }),
}))
