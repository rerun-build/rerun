'use client'

import { useEffect, useRef, type RefObject } from 'react'

const TAP_MAX_DISTANCE = 10
const TAP_MAX_DURATION = 300
const HOLD_TO_GRAB_MS = 450

type TouchGestureCallbacks = {
    onPanStart?: () => void
    onPan?: (dx: number, dy: number) => void
    onPanEnd?: () => void
    onZoom?: (scaleFactor: number, centerX: number, centerY: number) => void
    onTap?: (clientX: number, clientY: number) => void
    grabAt?: (clientX: number, clientY: number) => boolean
    onGrabHold?: (clientX: number, clientY: number) => void
    onGrabStart?: (clientX: number, clientY: number) => void
    onGrabMove?: (clientX: number, clientY: number) => void
    onGrabEnd?: (committed: boolean) => void
}

export function useTouchGestures(ref: RefObject<HTMLDivElement | null>, callbacks: TouchGestureCallbacks, enabled = true) {
    const stateRef = useRef({
        touchStart: { x: 0, y: 0, time: 0 },
        lastPanPoint: { x: 0, y: 0 },
        lastPinchDist: 0,
        isPanning: false,
        isPinching: false,
        moved: false,
        holding: false,
        grabbing: false,
        holdTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    })

    const cbRef = useRef(callbacks)
    cbRef.current = callbacks

    useEffect(() => {
        const el = ref.current
        if (!el || !enabled) return

        function getDistance(t1: Touch, t2: Touch) {
            return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
        }

        function getCenter(t1: Touch, t2: Touch) {
            return {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2,
            }
        }

        function dropHold() {
            const state = stateRef.current
            clearTimeout(state.holdTimer)
            if (state.holding) {
                state.holding = false
                cbRef.current.onGrabEnd?.(false)
            }
        }

        function endGrab(committed: boolean) {
            const state = stateRef.current
            if (!state.grabbing) return
            state.grabbing = false
            cbRef.current.onGrabEnd?.(committed)
        }

        function handleTouchStart(e: TouchEvent) {
            e.preventDefault()
            const state = stateRef.current

            if (e.touches.length === 1) {
                const t = e.touches[0]
                state.touchStart = { x: t.clientX, y: t.clientY, time: Date.now() }
                state.lastPanPoint = { x: t.clientX, y: t.clientY }
                state.isPinching = false
                state.moved = false

                state.isPanning = true
                cbRef.current.onPanStart?.()
                if (cbRef.current.grabAt?.(t.clientX, t.clientY)) {
                    state.holding = true
                    cbRef.current.onGrabHold?.(t.clientX, t.clientY)
                    state.holdTimer = setTimeout(() => {
                        if (!state.holding) return
                        state.holding = false
                        state.isPanning = false
                        state.grabbing = true
                        navigator.vibrate?.(10)
                        cbRef.current.onGrabStart?.(state.touchStart.x, state.touchStart.y)
                    }, HOLD_TO_GRAB_MS)
                }
            }

            if (e.touches.length === 2) {
                dropHold()
                endGrab(false)
                state.isPanning = false
                state.isPinching = true
                state.moved = true
                state.lastPinchDist = getDistance(e.touches[0], e.touches[1])
                state.lastPanPoint = getCenter(e.touches[0], e.touches[1])
            }
        }

        function handleTouchMove(e: TouchEvent) {
            e.preventDefault()
            const state = stateRef.current

            if (e.touches.length === 1 && state.grabbing) {
                const t = e.touches[0]
                cbRef.current.onGrabMove?.(t.clientX, t.clientY)
                return
            }

            if (e.touches.length === 1 && state.isPanning) {
                const t = e.touches[0]
                const dx = t.clientX - state.lastPanPoint.x
                const dy = t.clientY - state.lastPanPoint.y

                const totalDx = t.clientX - state.touchStart.x
                const totalDy = t.clientY - state.touchStart.y
                if (Math.hypot(totalDx, totalDy) > TAP_MAX_DISTANCE) {
                    state.moved = true
                    dropHold()
                }

                state.lastPanPoint = { x: t.clientX, y: t.clientY }
                cbRef.current.onPan?.(dx, dy)
            }

            if (e.touches.length === 2 && state.isPinching) {
                const dist = getDistance(e.touches[0], e.touches[1])
                const center = getCenter(e.touches[0], e.touches[1])

                if (state.lastPinchDist > 0) {
                    const scaleFactor = dist / state.lastPinchDist
                    cbRef.current.onZoom?.(scaleFactor, center.x, center.y)
                }

                const dx = center.x - state.lastPanPoint.x
                const dy = center.y - state.lastPanPoint.y
                cbRef.current.onPan?.(dx, dy)

                state.lastPanPoint = center
                state.lastPinchDist = dist
            }
        }

        function handleTouchEnd(e: TouchEvent) {
            e.preventDefault()
            const state = stateRef.current

            if (e.touches.length === 0 && state.grabbing) {
                endGrab(e.type !== 'touchcancel')
                return
            }

            if (e.touches.length === 0) {
                dropHold()
                if (state.isPanning && !state.moved) {
                    const elapsed = Date.now() - state.touchStart.time
                    if (elapsed < TAP_MAX_DURATION) {
                        cbRef.current.onTap?.(state.touchStart.x, state.touchStart.y)
                    }
                }

                if (state.isPanning) {
                    cbRef.current.onPanEnd?.()
                }

                state.isPanning = false
                state.isPinching = false
                state.lastPinchDist = 0
            }

            if (e.touches.length === 1) {
                state.isPinching = false
                state.isPanning = true
                const t = e.touches[0]
                state.lastPanPoint = { x: t.clientX, y: t.clientY }
                state.lastPinchDist = 0
            }
        }

        el.addEventListener('touchstart', handleTouchStart, { passive: false })
        el.addEventListener('touchmove', handleTouchMove, { passive: false })
        el.addEventListener('touchend', handleTouchEnd, { passive: false })
        el.addEventListener('touchcancel', handleTouchEnd, { passive: false })

        return () => {
            clearTimeout(stateRef.current.holdTimer)
            el.removeEventListener('touchstart', handleTouchStart)
            el.removeEventListener('touchmove', handleTouchMove)
            el.removeEventListener('touchend', handleTouchEnd)
            el.removeEventListener('touchcancel', handleTouchEnd)
        }
    }, [ref, enabled])
}
