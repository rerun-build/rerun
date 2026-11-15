import { useEffect, useState } from 'react'

export function useElapsed(active: boolean): number | undefined {
    const [seconds, setSeconds] = useState<number | undefined>(active ? 0 : undefined)
    const [wasActive, setWasActive] = useState(active)
    if (wasActive !== active) {
        setWasActive(active)
        if (active) setSeconds(0)
    }

    useEffect(() => {
        if (!active) return
        const start = Date.now()
        const id = setInterval(() => setSeconds(tick(start)), 100)
        return () => clearInterval(id)
    }, [active])

    return active || seconds === undefined ? seconds : Math.max(0.1, seconds)
}

function tick(start: number): number {
    const elapsed = (Date.now() - start) / 1000
    return elapsed < 10 ? Math.floor(elapsed * 10) / 10 : Math.floor(elapsed)
}

export function formatElapsed(seconds: number): string {
    if (seconds < 10) return `${seconds.toFixed(1)}s`
    if (seconds < 60) return `${Math.floor(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`
}
