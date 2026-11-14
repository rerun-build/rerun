'use client'

import type { OrbGaze } from '../foreman'
import { type RefObject, useEffect, useRef } from 'react'

type Point = { x: number; y: number }

const LOOK_REACH = 320
const LEAN = { x: 0.035, y: 0.025, max: 14 }
const SWING_MAX = 48
const DIALOG_FIELD_DROP = 108
const REST = 0.01

const clamp = (value: number, max: number) => Math.max(-max, Math.min(max, value))

export function useFollow({ rootRef, anchorRef, cursorRef, aim, fieldDrop = DIALOG_FIELD_DROP }: { rootRef: RefObject<HTMLElement | null>; anchorRef: RefObject<HTMLElement | null>; cursorRef?: RefObject<HTMLElement | null>; aim?: string; fieldDrop?: number }) {
    const gazeRef = useRef<OrbGaze | null>(null)

    useEffect(() => {
        const root = rootRef.current
        if (!root) return
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        let pointer: Point | null = aim ? aimAt(root, aim) : null
        let anchor = anchorIn(root, anchorRef.current)
        const current = { ox: 0, oy: 0, angle: 0 }
        let settled = false
        let last = performance.now()
        let frame: number | null = null

        const tick = (now: number) => {
            const dt = Math.min((now - last) / 1000, 0.05)
            last = now
            const dx = pointer ? pointer.x - anchor.x : 0
            const dy = pointer ? pointer.y - anchor.y : 0
            const target = {
                ox: pointer ? clamp(dx * LEAN.x, LEAN.max) : 0,
                oy: pointer ? clamp(dy * LEAN.y, LEAN.max * 0.7) : 0,
                angle: pointer ? clamp((Math.atan2(dx, Math.max(dy, 60)) * 180) / Math.PI, SWING_MAX) : 0,
            }
            const ease = settled ? 1 - Math.exp(-dt * 7) : 1
            settled = true
            current.ox += (target.ox - current.ox) * ease
            current.oy += (target.oy - current.oy) * ease
            current.angle += (target.angle - current.angle) * ease
            gazeRef.current = pointer ? { x: clamp(dx / LOOK_REACH, 1), y: clamp(dy / LOOK_REACH, 1) } : null

            root.style.setProperty('--orb-x', `${current.ox.toFixed(2)}px`)
            root.style.setProperty('--orb-y', `${current.oy.toFixed(2)}px`)
            root.style.setProperty('--light-angle', `${current.angle.toFixed(2)}deg`)
            root.style.setProperty('--light-tilt', `${Math.abs(current.angle).toFixed(2)}deg`)
            root.style.setProperty('--light-dx', `${(Math.tan((current.angle * Math.PI) / 180) * fieldDrop).toFixed(2)}px`)

            const cursor = cursorRef?.current
            if (cursor) {
                cursor.style.opacity = pointer ? '1' : '0'
                if (pointer) cursor.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`
            }
            const atRest = !pointer && Math.abs(current.ox) < REST && Math.abs(current.oy) < REST && Math.abs(current.angle) < REST
            frame = atRest ? null : requestAnimationFrame(tick)
        }
        const wake = () => {
            if (frame !== null) return
            last = performance.now()
            frame = requestAnimationFrame(tick)
        }
        wake()

        const onMove = (event: PointerEvent) => {
            const box = root.getBoundingClientRect()
            pointer = { x: event.clientX - box.left, y: event.clientY - box.top }
            anchor = anchorIn(root, anchorRef.current)
            wake()
        }
        const onLeave = () => {
            pointer = null
        }
        root.addEventListener('pointermove', onMove)
        root.addEventListener('pointerleave', onLeave)
        return () => {
            if (frame !== null) cancelAnimationFrame(frame)
            root.removeEventListener('pointermove', onMove)
            root.removeEventListener('pointerleave', onLeave)
        }
    }, [rootRef, anchorRef, cursorRef, aim, fieldDrop])

    return gazeRef
}

function anchorIn(root: HTMLElement, anchor: HTMLElement | null): Point {
    const origin = root.getBoundingClientRect()
    if (!anchor) return { x: origin.width / 2, y: 0 }
    const box = anchor.getBoundingClientRect()
    return { x: box.left - origin.left + box.width / 2, y: box.top - origin.top + box.height / 2 }
}

function aimAt(root: HTMLElement, selector: string): Point | null {
    const target = root.querySelector(selector)
    if (!target) return null
    const box = target.getBoundingClientRect()
    const origin = root.getBoundingClientRect()
    return { x: box.left - origin.left + box.width / 2 + 10, y: box.top - origin.top + box.height / 2 + 4 }
}
