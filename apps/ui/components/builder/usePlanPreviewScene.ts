'use client'

import { usePrefersReducedMotion } from '@moldwright/ui/iso-grid'
import { useEffect, useMemo, useState } from 'react'

import type { ShownPlan } from '@/components/foreman/widgets/plan-card'
import { planScene, settledPlanScene, type PlanScene } from '@/lib/foreman/plan-scene'
import type { SpaceRect } from '@/lib/board/space-layout'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'

export function useSettlingPlanScene(plan: ShownPlan | null, built?: SpaceRect[]): PlanScene | null {
    const still = usePrefersReducedMotion()
    const animated = !still
    const [settledFor, setSettledFor] = useState<PlanScene | null>(null)

    const landed = useMemo(() => {
        if (!plan) return null
        const scene = planScene(plan, { animated, built })
        return scene.containers.length ? scene : null
    }, [plan, animated, built])

    useEffect(() => {
        if (!landed || !animated) return
        const timer = setTimeout(() => setSettledFor(landed), landed.landedAt)
        return () => clearTimeout(timer)
    }, [landed, animated])

    const settled = !animated || settledFor === landed
    return useMemo(() => (landed && settled ? settledPlanScene(landed) : landed), [landed, settled])
}

export function usePlanPreviewScene(active: boolean, built: SpaceRect[]): PlanScene | null {
    const plan = useForemanStore(state => state.planPreview)
    const intakePlan = useForemanStore(state => state.intakePreview)
    const shown = active ? (plan ?? intakePlan) : null
    const scene = useSettlingPlanScene(shown, built)

    useEffect(() => {
        if (shown) useBoardStore.getState().recenterBoard()
    }, [shown])

    return scene
}
