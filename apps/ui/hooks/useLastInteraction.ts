'use client'

import { isIdle } from '@/lib/notifications/presence'
import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

// When the person last touched the page: a click, a key, a scroll, a tap. `touch()` counts something
// else as a sign of life (the window shown again). `onBackFromIdle` runs on the first gesture after
// PRESENCE_IDLE_MS without one.
export function useLastInteraction(enabled: boolean, onBackFromIdle?: () => void) {
    const lastInteractionRef = useRef(0)
    const backFromIdle = useEffectEvent(() => onBackFromIdle?.())

    useEffect(() => {
        if (!enabled) return
        lastInteractionRef.current = Date.now()
        const bump = () => {
            const wasIdle = isIdle(lastInteractionRef.current, Date.now())
            lastInteractionRef.current = Date.now()
            if (wasIdle) backFromIdle()
        }
        INTERACTION_EVENTS.forEach(event => window.addEventListener(event, bump, { passive: true }))
        return () => INTERACTION_EVENTS.forEach(event => window.removeEventListener(event, bump))
    }, [enabled])

    const touch = useCallback(() => {
        lastInteractionRef.current = Date.now()
    }, [])
    return { lastInteractionRef, touch }
}
