import { useEffect } from 'react'
import { create } from 'zustand'

// What the boot cover waits for before showing the app in one go: the board past its loading gate,
// and every part on screen that would otherwise paint a skeleton of its own (the open column reading
// its conversation). Starts not ready, so the server's HTML already carries the cover.
type AppBootState = {
    boardReady: boolean
    holds: number
    setBoardReady: (ready: boolean) => void
    hold: () => () => void
}

export const useAppBootStore = create<AppBootState>()(set => ({
    boardReady: false,
    holds: 0,
    setBoardReady: boardReady => set({ boardReady }),
    hold: () => {
        set(state => ({ holds: state.holds + 1 }))
        return () => set(state => ({ holds: state.holds - 1 }))
    },
}))

export function useHoldAppBoot(active: boolean) {
    const hold = useAppBootStore(state => state.hold)
    useEffect(() => (active ? hold() : undefined), [active, hold])
}
