'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from './iso-grid/hooks/usePrefersReducedMotion'

const RELEASE_SLACK_MS = 40

export function useTransientTransition(defaultMs = 300) {
    const reducedMotion = usePrefersReducedMotion()
    const [durationMs, setDurationMs] = useState<number | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearTimer = () => {
        if (timer.current) {
            clearTimeout(timer.current)
            timer.current = null
        }
    }

    const animate = useCallback(
        (ms: number = defaultMs) => {
            if (reducedMotion || !(ms > 0)) return
            setDurationMs(ms)
            clearTimer()
            timer.current = setTimeout(() => setDurationMs(null), ms + RELEASE_SLACK_MS)
        },
        [defaultMs, reducedMotion]
    )

    const cancel = useCallback(() => {
        clearTimer()
        setDurationMs(null)
    }, [])

    useEffect(() => clearTimer, [])

    return { animating: durationMs !== null, durationMs, animate, cancel }
}
