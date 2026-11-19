'use client'

import { usePrefersReducedMotion } from '@rerun/ui/iso-grid'
import { useEffect, useMemo, useState } from 'react'

import type { ShownPlan } from '@/components/foreman/widgets/plan-card'
import { planScene, settledPlanScene, type PlanScene } from '@/lib/foreman/plan-scene'
import { usePlanSceneLabels } from '@/lib/foreman/usePlanSceneLabels'
import type { SpaceRect } from '@/lib/board/space-layout'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'

// L'aperçu du plan, côté board : la scène, et le moment où elle passe de « en train d'être posée »
// à « pas encore construite ». Sorti d'IsoBoard, qui a déjà bien assez d'états à tenir.

/**
 * La scène et son unique battement : elle se pose, puis vire à la maquette. Une organisation qui
 * change (« Change something ») rejoue son entrée, donc redevient opaque le temps de retomber.
 */
export function useSettlingPlanScene(plan: ShownPlan | null, built?: SpaceRect[]): PlanScene | null {
    const still = usePrefersReducedMotion()
    const animated = !still
    const labels = usePlanSceneLabels()
    const [settledFor, setSettledFor] = useState<PlanScene | null>(null)

    const landed = useMemo(() => {
        if (!plan) return null
        const scene = planScene(plan, { animated, built, labels })
        // Une organisation sans division ne se dessine pas : il ne resterait que la pastille, posée
        // sur une grille nue, à annoncer ce qui n'arrive pas.
        return scene.containers.length ? scene : null
    }, [plan, animated, built, labels])

    // La bascule est portée par le minuteur seul : une scène qui change n'est plus celle qui s'était
    // posée, donc elle redevient opaque sans qu'on ait à la remettre à zéro.
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
    // Les divisions que la carte d'accueil a dessinées tiennent l'écran jusqu'à ce que le Foreman
    // pose les siennes : son plan est plus précis, il remplace l'esquisse, mais tant qu'il n'existe
    // pas le board n'a pas à redevenir vide.
    const intakePlan = useForemanStore(state => state.intakePreview)
    const shown = active ? (plan ?? intakePlan) : null
    const scene = useSettlingPlanScene(shown, built)

    // Une division de plus et la rosace n'a plus la même étendue : le cadrage se refait à chaque
    // organisation, par le même signal que le Foreman utilise après avoir posé ses vraies Box.
    useEffect(() => {
        if (shown) useBoardStore.getState().recenterBoard()
    }, [shown])

    return scene
}
