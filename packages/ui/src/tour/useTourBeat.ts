'use client'

import { useEffect, useRef, useState } from 'react'

export function useTourBeat(beats: readonly { hold: number }[], paused: boolean): number {
    const [tick, setTick] = useState(0)
    const tickRef = useRef(0)

    useEffect(() => {
        if (paused) return
        let timer: ReturnType<typeof setTimeout>
        const advance = (current: number) => {
            timer = setTimeout(() => {
                const next = current + 1
                tickRef.current = next
                setTick(next)
                advance(next)
            }, beats[current % beats.length].hold)
        }
        advance(tickRef.current)
        return () => clearTimeout(timer)
    }, [beats, paused])

    return tick
}
