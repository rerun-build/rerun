'use client'

import { useEffect, useState } from 'react'

const TICK_MS = 100

// Cycles through `count` items, one every `periodMs`, with how far the current one has run (0 to 100)
// for a bar that fills while it shows. `show` jumps to an item and restarts its time.
export function useTimedRotation(count: number, periodMs: number) {
    const [index, setIndex] = useState(0)
    const [elapsed, setElapsed] = useState(0)

    useEffect(() => {
        if (count < 2) return
        const startedAt = performance.now()
        const timer = setInterval(() => {
            const percent = ((performance.now() - startedAt) / periodMs) * 100
            if (percent < 100) return setElapsed(percent)
            setElapsed(0)
            setIndex(current => (current + 1) % count)
        }, TICK_MS)
        return () => clearInterval(timer)
    }, [index, count, periodMs])

    const show = (next: number) => {
        setElapsed(0)
        setIndex(next)
    }

    return { index, elapsed, show }
}
