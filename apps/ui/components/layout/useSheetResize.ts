'use client'

import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { coversTheBoard } from '@/lib/foreman-open'

/** Les deux crans d'une sheet mobile, ceux d'iOS. */
export type SheetDetent = 'medium' | 'large'

const DETENT_HEIGHTS: Record<SheetDetent, string> = {
    medium: '50dvh',
    large: 'calc(96dvh - env(safe-area-inset-top))',
}

/** Sous ce déplacement, un appui sur la barre n'est qu'un tap. */
const LIFT_DISTANCE = 6
/** Le `UIScrollView.DecelerationRate.normal` d'iOS, qui projette où un lancer s'arrêterait. */
const DECELERATION_RATE = 0.998
/** Les seuils de vaul, qui imite la sheet d'iOS : un lancer vers le bas ou un quart de sa hauteur la ferme. */
const DISMISS_VELOCITY = 0.4
const DISMISS_FRACTION = 0.25
const RUBBER_BAND = 0.55
const VELOCITY_WINDOW_MS = 100
/** La durée de la transition de la sheet, `duration-500` sur le panneau. */
export const SHEET_TRANSITION_MS = 500

type Candidate = { detent: SheetDetent | null; height: number }
type Sample = { t: number; y: number }

function project(velocity: number): number {
    return (velocity * DECELERATION_RATE) / (1 - DECELERATION_RATE)
}

/** L'élastique d'`UIScrollView` : on tire toujours, on gagne de moins en moins. */
function rubberBand(overshoot: number, dimension: number): number {
    return (1 - 1 / ((overshoot * RUBBER_BAND) / dimension + 1)) * dimension
}

type SheetResizeOptions = {
    panelRef: RefObject<HTMLDivElement | null>
    dragVar: `--${string}`
    detentVar: `--${string}`
    /** `null` : jamais redimensionnée, la sheet garde la hauteur que lui donne son CSS. */
    loadDetent: () => SheetDetent | null
    rememberDetent: (detent: SheetDetent) => void
    onDismiss: () => void
    /** Lu au geste : une sheet qui ne peut pas se fermer résiste sous son plancher et y revient. */
    canDismiss?: () => boolean
}

/**
 * Tirer une sheet mobile par sa barre, comme une sheet iOS : elle suit le doigt, résiste
 * au-dessus du grand cran, descend en bloc sous le plus bas, et au lâcher la vitesse du geste
 * projette où elle se pose, ou la ferme. La hauteur passe par des custom properties écrites sur le
 * nœud, jamais par React : `dragVar` pendant le geste, `detentVar` pour le cran retenu, qui survit
 * au rechargement.
 */
export function useSheetResize({ panelRef, dragVar, detentVar, loadDetent, rememberDetent, onDismiss, canDismiss }: SheetResizeOptions) {
    // Le cran n'est jamais rendu, seulement écrit sur le nœud : le lire au premier rendu ne peut pas
    // désaccorder l'hydratation, et côté serveur le `try` de la lecture rend `null`.
    const [detent, setDetent] = useState(loadDetent)
    const [dragging, setDragging] = useState(false)
    const teardownRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        const panel = panelRef.current
        if (!panel) return
        if (detent) panel.style.setProperty(detentVar, DETENT_HEIGHTS[detent])
        else panel.style.removeProperty(detentVar)
    }, [detent, detentVar, panelRef])

    useEffect(() => () => teardownRef.current?.(), [])

    const settle = useCallback(
        (next: SheetDetent) => {
            panelRef.current?.style.setProperty(detentVar, DETENT_HEIGHTS[next])
            setDetent(next)
            rememberDetent(next)
        },
        [panelRef, detentVar, rememberDetent]
    )

    const toggleDetent = useCallback(() => settle(detent === 'large' ? 'medium' : 'large'), [detent, settle])

    const onPointerDown = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            if (event.button !== 0 || teardownRef.current || !coversTheBoard()) return
            if (event.target instanceof Element && event.target.closest('button:not([data-sheet-grabber]), a, input, textarea, [role="menuitem"], [role="tablist"]')) return
            const panel = panelRef.current
            if (!panel) return

            const pointerId = event.pointerId
            const startY = event.clientY
            const startHeight = panel.getBoundingClientRect().height
            const computed = getComputedStyle(panel)
            const largeHeight = parseFloat(computed.maxHeight) || window.innerHeight
            const screenHeight = (panel.offsetParent as HTMLElement | null)?.clientHeight ?? window.innerHeight
            // Le `min-height` du panneau garde le pied entier : le moyen cran ne descend pas sous lui.
            const mediumHeight = Math.max(screenHeight / 2, parseFloat(computed.minHeight) || 0)
            // L'élastique tend vers le haut de l'écran sans jamais l'atteindre.
            const stretchRoom = Math.max(screenHeight - largeHeight, 1)
            const candidates: Candidate[] = [
                { detent: 'medium', height: mediumHeight },
                { detent: 'large', height: largeHeight },
            ]
            // Jamais redimensionnée, sa hauteur de contenu reste une place où revenir.
            if (!detent) candidates.push({ detent: null, height: startHeight })
            const floor = Math.min(...candidates.map(candidate => candidate.height))
            const dismissible = canDismiss?.() ?? true
            const samples: Sample[] = [{ t: event.timeStamp, y: startY }]
            let lifted = false
            let rawHeight = startHeight

            const move = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== pointerId) return
                if (!lifted) {
                    if (Math.abs(moveEvent.clientY - startY) < LIFT_DISTANCE) return
                    lifted = true
                    panel.setAttribute('data-sheet-dragging', '')
                    setDragging(true)
                }
                samples.push({ t: moveEvent.timeStamp, y: moveEvent.clientY })
                while (samples.length > 2 && moveEvent.timeStamp - samples[0].t > VELOCITY_WINDOW_MS) samples.shift()
                rawHeight = startHeight + startY - moveEvent.clientY
                const height = rawHeight > largeHeight ? largeHeight + rubberBand(rawHeight - largeHeight, stretchRoom) : Math.max(rawHeight, floor)
                panel.style.setProperty(dragVar, `${height}px`)
                const below = Math.max(floor - rawHeight, 0)
                panel.style.translate = below > 0 ? `0 ${dismissible ? below : rubberBand(below, floor)}px` : ''
            }

            const finish = () => {
                teardown()
                if (!lifted) return
                const first = samples[0]
                const last = samples[samples.length - 1]
                const downwardVelocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0
                const dismissed = dismissible && rawHeight < floor && (floor - rawHeight > floor * DISMISS_FRACTION || downwardVelocity > DISMISS_VELOCITY)

                // Le tap qui suit un geste lâché sur la poignée ne doit pas encore basculer de cran.
                const swallowClick = (clickEvent: MouseEvent) => clickEvent.stopPropagation()
                window.addEventListener('click', swallowClick, { capture: true, once: true })
                setTimeout(() => window.removeEventListener('click', swallowClick, true), 0)

                // Tout part dans le même frame que la transition qui revient : elle anime du doigt au cran.
                panel.removeAttribute('data-sheet-dragging')
                setDragging(false)
                panel.style.removeProperty(dragVar)
                if (dismissed) {
                    // Le `translate-y-full` de la fermeture n'arrive qu'au rendu suivant : sans ce relais
                    // la sheet remonterait d'abord vers sa place avant de redescendre.
                    panel.style.translate = '0 100%'
                    setTimeout(() => (panel.style.translate = ''), SHEET_TRANSITION_MS)
                    onDismiss()
                    return
                }
                panel.style.translate = ''
                // Un lancer depuis le grand cran s'arrête au moyen, comme sur iOS : on ne ferme que depuis le bas.
                const projected = Math.max(rawHeight - project(downwardVelocity), floor)
                const target = candidates.reduce((best, candidate) => (Math.abs(candidate.height - projected) < Math.abs(best.height - projected) ? candidate : best))
                if (target.detent) settle(target.detent)
            }

            const up = (upEvent: PointerEvent) => {
                if (upEvent.pointerId === pointerId) finish()
            }

            function teardown() {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', up)
                teardownRef.current = null
            }

            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
            window.addEventListener('pointercancel', up)
            teardownRef.current = teardown
        },
        [panelRef, detent, settle, dragVar, onDismiss, canDismiss]
    )

    return { detent, dragging, onPointerDown, toggleDetent }
}
