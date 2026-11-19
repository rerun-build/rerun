'use client'

import { usePrefersReducedMotion } from '@moldwright/ui/iso-grid'
import { useTourBeat } from '@moldwright/ui/tour'
import { useMemo } from 'react'

import { planLifeAt, planLifeBeats } from '@/lib/foreman/plan-life'
import type { PlanBeats } from './plan-card'

const NO_DAY: PlanBeats = { trigger: '', working: '', delivered: '' }

export function usePlanLife(script: PlanBeats | null, waiting: boolean) {
    const still = usePrefersReducedMotion()
    const paused = still || waiting || !script
    const { trigger, working, delivered } = script ?? NO_DAY
    const beats = useMemo(() => planLifeBeats({ trigger, working, delivered }), [trigger, working, delivered])
    const tick = useTourBeat(beats, paused)

    return { beat: planLifeAt(beats, paused ? 0 : tick), tick, animated: !still }
}
