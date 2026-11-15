'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type StoryPosition = {
    index: number
    run: number
}

export function useStoryClock(durations: readonly number[], running: boolean) {
    const [position, setPosition] = useState<StoryPosition>({ index: 0, run: 0 })
    const remaining = useRef({ run: -1, ms: 0 })
    const count = durations.length
    const index = count > 0 ? Math.min(position.index, count - 1) : 0
    const duration = durations[index] ?? 0

    useEffect(() => {
        if (!running || count < 2) return
        if (remaining.current.run !== position.run) remaining.current = { run: position.run, ms: duration }

        const startedAt = performance.now()
        const run = position.run
        const timer = window.setTimeout(() => setPosition(current => ({ index: (Math.min(current.index, count - 1) + 1) % count, run: current.run + 1 })), remaining.current.ms)
        return () => {
            window.clearTimeout(timer)
            if (remaining.current.run === run) remaining.current.ms = Math.max(0, remaining.current.ms - (performance.now() - startedAt))
        }
    }, [running, count, duration, position.run])

    const goTo = useCallback((index: number) => setPosition(current => ({ index: ((index % count) + count) % count, run: current.run + 1 })), [count])

    return { index, run: position.run, goTo }
}
