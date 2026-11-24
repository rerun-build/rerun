'use client'

import { animate, useReducedMotion } from 'motion/react'
import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { type ForemanPlacement, clampForemanFloatSize, resolveDropTarget, sameForemanPlacement, serializeForemanPlacement } from '@/lib/foreman-layout'
import { coversTheBoard } from '@/lib/foreman-open'
import { useUiDirection } from '@rerun/ui/locale'
import { useForemanStore } from '@/stores/foreman.store'

type Point = { x: number; y: number }

/** Sous ce déplacement, un appui sur l'en-tête n'est qu'un clic : la colonne ne décolle pas. */
const LIFT_DISTANCE = 6
/** Ce qu'on garde de la fenêtre de part et d'autre du pointeur quand on la décroche d'un dock. */
const GRAB_MARGIN = 24
const LANDING_DURATION_S = 0.22

/**
 * Tenir la colonne par son en-tête. Une fois décollée elle suit le pointeur en `fixed` sous sa
 * taille flottante, le store publie la place qu'elle viserait (le fantôme la dessine) et le lâcher
 * l'y pose. La position ne passe jamais par React : un `transform` écrit sur le nœud à chaque move.
 */
export function useForemanDrag({ panelRef, placement }: { panelRef: RefObject<HTMLDivElement | null>; placement: ForemanPlacement }) {
    const direction = useUiDirection()
    const reduceMotion = useReducedMotion()
    const [dragOrigin, setDragOrigin] = useState<Point | null>(null)
    const [landing, setLanding] = useState(0)
    const landingFromRef = useRef<DOMRect | null>(null)
    const placementRef = useRef(placement)
    const teardownRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        placementRef.current = placement
    }, [placement])

    useEffect(() => () => teardownRef.current?.(), [])

    const onPointerDown = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            if (event.button !== 0 || teardownRef.current || coversTheBoard()) return
            if (event.target instanceof Element && event.target.closest('button, a, input, textarea, [role="menuitem"], [role="tablist"]')) return
            const panel = panelRef.current
            if (!panel) return

            const pointerId = event.pointerId
            const start = { x: event.clientX, y: event.clientY }
            const rect = panel.getBoundingClientRect()
            const origin = placementRef.current
            const size = clampForemanFloatSize(origin, { width: window.innerWidth, height: window.innerHeight })
            const grab =
                origin.mode === 'float'
                    ? { x: start.x - rect.left, y: start.y - rect.top }
                    : { x: Math.min(Math.max(start.x - rect.left, GRAB_MARGIN), size.width - GRAB_MARGIN), y: start.y - rect.top }
            let lifted = false
            let target: ForemanPlacement = origin
            const previousBodyStyles = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }

            const move = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== pointerId) return
                const position = { x: moveEvent.clientX - grab.x, y: moveEvent.clientY - grab.y }
                if (!lifted) {
                    if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < LIFT_DISTANCE) return
                    lifted = true
                    document.body.style.cursor = 'grabbing'
                    document.body.style.userSelect = 'none'
                    setDragOrigin(position)
                } else {
                    panel.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`
                }
                const next = resolveDropTarget({
                    pointer: { x: moveEvent.clientX, y: moveEvent.clientY },
                    panelCenter: { x: position.x + size.width / 2, y: position.y + size.height / 2 },
                    viewport: { width: window.innerWidth, height: window.innerHeight },
                    size: { width: origin.width, height: origin.height, dockWidth: origin.dockWidth },
                    direction,
                })
                if (useForemanStore.getState().dropTarget && sameForemanPlacement(next, target)) return
                target = next
                useForemanStore.getState().setDropTarget(next)
            }

            const finish = (cancelled: boolean) => {
                teardown()
                if (!lifted) return
                const landingPlacement = cancelled ? origin : target
                // Seule une fenêtre qui atterrit dans un coin glisse jusqu'à sa place ; un dock
                // s'ouvre par sa piste de grille, la même entrée que depuis l'orbe.
                if (landingPlacement.mode === 'float') {
                    landingFromRef.current = panel.getBoundingClientRect()
                    setLanding(count => count + 1)
                }
                if (!cancelled) useForemanStore.getState().setPlacement(landingPlacement)
                useForemanStore.getState().setDropTarget(null)
                setDragOrigin(null)
            }

            const up = (upEvent: PointerEvent) => {
                if (upEvent.pointerId === pointerId) finish(false)
            }
            const cancel = (cancelEvent: PointerEvent) => {
                if (cancelEvent.pointerId === pointerId) finish(true)
            }
            // En capture, pour passer avant l'Escape de la colonne, qui la refermerait.
            const keydown = (keyEvent: KeyboardEvent) => {
                if (keyEvent.key !== 'Escape' || !lifted) return
                keyEvent.preventDefault()
                keyEvent.stopImmediatePropagation()
                finish(true)
            }

            function teardown() {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', cancel)
                window.removeEventListener('keydown', keydown, true)
                document.body.style.cursor = previousBodyStyles.cursor
                document.body.style.userSelect = previousBodyStyles.userSelect
                teardownRef.current = null
            }

            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
            window.addEventListener('pointercancel', cancel)
            window.addEventListener('keydown', keydown, true)
            teardownRef.current = teardown
        },
        [panelRef, direction]
    )

    const placementKey = serializeForemanPlacement(placement)
    useLayoutEffect(() => {
        const from = landingFromRef.current
        const panel = panelRef.current
        if (!from || !panel) return
        landingFromRef.current = null
        if (reduceMotion) return
        const to = panel.getBoundingClientRect()
        const dx = from.left - to.left
        const dy = from.top - to.top
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
        const controls = animate(panel, { transform: [`translate3d(${dx}px, ${dy}px, 0)`, 'translate3d(0px, 0px, 0)'] }, { duration: LANDING_DURATION_S, ease: 'easeOut' })
        void controls.then(() => panel.style.removeProperty('transform'))
        return () => controls.stop()
    }, [landing, placementKey, panelRef, reduceMotion])

    return { onPointerDown, dragOrigin }
}
