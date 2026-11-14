import { useEffect } from 'react'
import { create } from 'zustand'

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
