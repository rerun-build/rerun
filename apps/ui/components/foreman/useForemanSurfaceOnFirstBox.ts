'use client'

import { useEffect, useRef } from 'react'

import { refreshForemanSurface } from '@/components/foreman/useForemanKickoff'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'

/**
 * A workspace past its onboarding with no machine has no Chief of Staff. Creating its first Box claims
 * the machine: once a Box shows on a board that was seen empty, which foreman the workspace talks to
 * is asked again rather than left at « none » until a reload. A workspace whose machine went away
 * keeps its Boxes, and loading them asks nothing.
 */
export function useForemanSurfaceOnFirstBox() {
    const noForeman = useForemanStore(state => state.surface === 'none')
    const hydrated = useBoardStore(state => state.hydrated)
    const hasBox = useBoardStore(state => state.spaces.length > 0)
    const sawEmptyBoard = useRef(false)

    useEffect(() => {
        if (!hydrated) {
            sawEmptyBoard.current = false
            return
        }
        if (!noForeman) return
        if (!hasBox) {
            sawEmptyBoard.current = true
            return
        }
        if (!sawEmptyBoard.current) return
        sawEmptyBoard.current = false
        void refreshForemanSurface()
    }, [noForeman, hydrated, hasBox])
}
