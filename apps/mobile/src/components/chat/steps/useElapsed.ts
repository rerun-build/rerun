import { useEffect, useRef, useState } from 'react'

export function useElapsed(active: boolean): number | undefined {
    const [seconds, setSeconds] = useState<number | undefined>(undefined)
    const startRef = useRef<number | null>(null)

    useEffect(() => {
        if (active) {
            const start = Date.now()
            startRef.current = start
            setSeconds(0)
            const id = setInterval(() => setSeconds(tick(start)), 100)
            return () => clearInterval(id)
        }
        if (startRef.current !== null) {
            setSeconds(Math.max(0.1, tick(startRef.current)))
            startRef.current = null
        }
    }, [active])

    return seconds
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
