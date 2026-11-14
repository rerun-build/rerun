import { create } from 'zustand'

type BuilderDialogsState = {
    newAgentOpen: boolean
    libraryOpen: boolean
    librarySlug: string | null
    newBoxOpen: boolean
    openNewAgent: () => void
    setNewAgentOpen: (open: boolean) => void
    openLibrary: (slug?: string) => void
    setLibraryOpen: (open: boolean) => void
    setNewBoxOpen: (open: boolean) => void
}

export const useBuilderDialogsStore = create<BuilderDialogsState>(set => ({
    newAgentOpen: false,
    libraryOpen: false,
    librarySlug: null,
    newBoxOpen: false,
    openNewAgent: () => set({ newAgentOpen: true, libraryOpen: false }),
    setNewAgentOpen: newAgentOpen => set({ newAgentOpen }),
    openLibrary: slug => set({ libraryOpen: true, librarySlug: slug ?? null, newAgentOpen: false }),
    setLibraryOpen: libraryOpen => set({ libraryOpen }),
    setNewBoxOpen: newBoxOpen => set({ newBoxOpen }),
}))
