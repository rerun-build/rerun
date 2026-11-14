'use client'

import { useMotionValue, type MotionValue } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

const RESTART_THRESHOLD = 0.15

export type StoryPlayer = {
    index: number
    progress: MotionValue<number>
    paused: boolean
    next: () => void
    prev: () => void
    goTo: (index: number) => void
    setHeld: (held: boolean) => void
}

export function useStoryPlayer(count: number, durationMs: number, startAt = 0): StoryPlayer {
    const [index, setIndex] = useState(Math.min(startAt, count - 1))
    const [held, setHeld] = useState(false)
    const [hidden, setHidden] = useState(false)
    const progress = useMotionValue(0)
    const paused = held || hidden

    const goTo = useCallback(
        (target: number) => {
            progress.set(0)
            setIndex(Math.max(0, Math.min(count - 1, target)))
        },
        [count, progress]
    )

    const next = useCallback(() => {
        if (index < count - 1) goTo(index + 1)
    }, [count, goTo, index])

    const prev = useCallback(() => {
        if (index === 0 || progress.get() > RESTART_THRESHOLD) goTo(index)
        else goTo(index - 1)
    }, [goTo, index, progress])

    useEffect(() => {
        const onVisibility = () => setHidden(document.hidden)
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [])

    useEffect(() => {
        if (paused) return
        let frame = 0
        let last = performance.now()
        const tick = (now: number) => {
            const value = Math.min(1, progress.get() + (now - last) / durationMs)
            last = now
            progress.set(value)
            if (value < 1) frame = requestAnimationFrame(tick)
            else if (index < count - 1) goTo(index + 1)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [count, durationMs, goTo, index, paused, progress])

    return { index, progress, paused, next, prev, goTo, setHeld }
}
