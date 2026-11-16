'use client'

import { useEffect } from 'react'

import { PAGE_UNATTENDED_ATTRIBUTE } from '../../primitives/use-page-unattended'

// A buddy blinks once every 4.6 s, its lids shut for the last 8 % of the cycle. An endless CSS
// animation did it, immobile 92 % of the time but still costing the browser a frame on every refresh
// of the screen, for every face of the page. One timer for the whole page now sets `data-blink` on a
// face for the 0.368 s of its blink (iso-grid/styles.css), at the same instant of the same cycle,
// shifted by each agent's `--buddy-blink-delay`.
export const BLINK_PERIOD_MS = 4600
export const BLINK_MS = BLINK_PERIOD_MS * 0.08
const BLINK_START_MS = BLINK_PERIOD_MS - BLINK_MS
// A timer fires a little late: a face whose blink began less than this ago still blinks now.
const LATE_MS = 120

const FACES = '.iso-buddy-eyes, [data-buddy-alive] .iso-buddy-lids'
const SKIPPED = '[data-buddy-still], [data-iso-paused]'
const BLINK_ATTRIBUTE = 'data-blink'

const mod = (value: number, by: number) => ((value % by) + by) % by

// How long until the blink of a face whose cycle is shifted by `delayMs` (negative, like the CSS
// animation-delay it replaces) starts, from `now`. 0 when it should be blinking right now.
export function msUntilBlink(now: number, delayMs: number): number {
    return msSinceBlinkStart(now, delayMs) < LATE_MS ? 0 : msUntilNextBlink(now, delayMs)
}

// How long until that face's next blink starts, even while one is under way: never 0. The timer aims
// at it, so a tick that fired late does not push the following one later still.
export function msUntilNextBlink(now: number, delayMs: number): number {
    return BLINK_PERIOD_MS - msSinceBlinkStart(now, delayMs)
}

function msSinceBlinkStart(now: number, delayMs: number): number {
    return mod(now - delayMs - BLINK_START_MS, BLINK_PERIOD_MS)
}

function delayOf(face: Element): number {
    const host = face.closest<HTMLElement>('[style*="--buddy-blink-delay"]')
    const seconds = Number.parseFloat(host?.style.getPropertyValue('--buddy-blink-delay') ?? '')
    return Number.isFinite(seconds) ? seconds * 1000 : 0
}

let users = 0
let timer: ReturnType<typeof setTimeout> | undefined

function blink(face: Element) {
    if (face.hasAttribute(BLINK_ATTRIBUTE)) return
    face.setAttribute(BLINK_ATTRIBUTE, '')
    setTimeout(() => face.removeAttribute(BLINK_ATTRIBUTE), BLINK_MS + 40)
}

function tick() {
    timer = undefined
    if (users === 0) return
    const now = performance.now()
    const unattended = document.documentElement.hasAttribute(PAGE_UNATTENDED_ATTRIBUTE)
    let next = BLINK_PERIOD_MS
    for (const face of document.querySelectorAll(FACES)) {
        const delayMs = delayOf(face)
        if (msUntilBlink(now, delayMs) === 0 && !unattended && !face.closest(SKIPPED)) blink(face)
        next = Math.min(next, msUntilNextBlink(now, delayMs))
    }
    timer = setTimeout(tick, Math.max(next, 16))
}

// Mounted by every component that draws a buddy's face: the timer runs while one is on the page.
export function useBuddyBlinks() {
    useEffect(() => {
        users++
        if (users === 1 && timer === undefined) timer = setTimeout(tick, 0)
        return () => {
            users--
            if (users > 0 || timer === undefined) return
            clearTimeout(timer)
            timer = undefined
        }
    }, [])
}
