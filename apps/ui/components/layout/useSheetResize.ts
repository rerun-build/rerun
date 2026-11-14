'use client'

import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { coversTheBoard } from '@/lib/foreman-open'

export type SheetDetent = 'medium' | 'large'

const DETENT_HEIGHTS: Record<SheetDetent, string> = {
    medium: '50dvh',
    large: 'calc(96dvh - env(safe-area-inset-top))',
}

const LIFT_DISTANCE = 6
const DECELERATION_RATE = 0.998
const DISMISS_VELOCITY = 0.4
const DISMISS_FRACTION = 0.25
const RUBBER_BAND = 0.55
const VELOCITY_WINDOW_MS = 100
const DISMISS_HANDOFF_MS = 500

type Candidate = { detent: SheetDetent | null; height: number }
type Sample = { t: number; y: number }

function project(velocity: number): number {
    return (velocity * DECELERATION_RATE) / (1 - DECELERATION_RATE)
}

function rubberBand(overshoot: number, dimension: number): number {
    return (1 - 1 / ((overshoot * RUBBER_BAND) / dimension + 1)) * dimension
}

type SheetResizeOptions = {
    panelRef: RefObject<HTMLDivElement | null>
    dragVar: `--${string}`
    detentVar: `--${string}`
    loadDetent: () => SheetDetent | null
    rememberDetent: (detent: SheetDetent) => void
    onDismiss: () => void
    canDismiss?: () => boolean
}

export function useSheetResize({ panelRef, dragVar, detentVar, loadDetent, rememberDetent, onDismiss, canDismiss }: SheetResizeOptions) {
    const [detent, setDetent] = useState(loadDetent)
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
            const mediumHeight = Math.max(screenHeight / 2, parseFloat(computed.minHeight) || 0)
            const stretchRoom = Math.max(screenHeight - largeHeight, 1)
            const candidates: Candidate[] = [
                { detent: 'medium', height: mediumHeight },
                { detent: 'large', height: largeHeight },
            ]
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

                const swallowClick = (clickEvent: MouseEvent) => clickEvent.stopPropagation()
                window.addEventListener('click', swallowClick, { capture: true, once: true })
                setTimeout(() => window.removeEventListener('click', swallowClick, true), 0)

                panel.removeAttribute('data-sheet-dragging')
                panel.style.removeProperty(dragVar)
                if (dismissed) {
                    panel.style.translate = '0 100%'
                    setTimeout(() => (panel.style.translate = ''), DISMISS_HANDOFF_MS)
                    onDismiss()
                    return
                }
                panel.style.translate = ''
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

    return { onPointerDown, toggleDetent }
}
