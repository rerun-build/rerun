import { create } from 'zustand'

type SimpleDetailsState = {
    // Null until the person opens or closes the card: it then follows the window's width.
    wanted: boolean | null
    setWanted: (wanted: boolean | null) => void
}

/**
 * Whether the Simple view's card column is wanted. Kept out of the frame's state so the button that
 * toggles it and the column re-render alone: the chats mounted beside them never do.
 */
export const useSimpleDetailsStore = create<SimpleDetailsState>(set => ({
    wanted: null,
    setWanted: wanted => set({ wanted }),
}))
