import { create } from 'zustand'

type SimpleDetailsState = {
    // Closed until the person opens it, whatever the window's width.
    wanted: boolean
    setWanted: (wanted: boolean) => void
}

/**
 * Whether the Simple view's card column is wanted. Kept out of the frame's state so the button that
 * toggles it and the column re-render alone: the chats mounted beside them never do.
 */
export const useSimpleDetailsStore = create<SimpleDetailsState>(set => ({
    wanted: false,
    setWanted: wanted => set({ wanted }),
}))
