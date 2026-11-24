import { useEffect } from 'react'
import { create } from 'zustand'

// Counts what is currently drawn over the board, the modal overlays and a coworker's sheet filling a
// phone: behind one, its animations only cost a backdrop blur recomputed on every frame, or are not
// seen at all.
type BoardCoverState = {
    covers: number
    cover: () => () => void
}

export const useBoardCoverStore = create<BoardCoverState>()(set => ({
    covers: 0,
    cover: () => {
        set(state => ({ covers: state.covers + 1 }))
        return () => set(state => ({ covers: state.covers - 1 }))
    },
}))

export function useCoverBoard() {
    const cover = useBoardCoverStore(state => state.cover)
    useEffect(() => cover(), [cover])
}
