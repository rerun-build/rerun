'use client'

import { TOUR_AGENTS_PHASE, useTourBeat } from '@rerun/ui/tour'
import { usePrefersReducedMotion } from '@rerun/ui/iso-grid'
import { useState } from 'react'

const WALK_BEATS: readonly { hold: number }[] = [{ hold: 2600 }]

export function useBoxExplainerWalk(): number {
    const still = usePrefersReducedMotion()
    const [arrived, setArrived] = useState(false)
    const tick = useTourBeat(WALK_BEATS, still || arrived)

    if (tick >= TOUR_AGENTS_PHASE && !arrived) setArrived(true)

    return still ? TOUR_AGENTS_PHASE : Math.min(tick, TOUR_AGENTS_PHASE)
}
