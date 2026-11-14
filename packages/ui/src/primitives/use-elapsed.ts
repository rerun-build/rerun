'use client'

import { useEffect, useRef, useState } from 'react'

export { formatElapsed } from '@rerun/contracts'

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
    const e = (Date.now() - start) / 1000
    return e < 10 ? Math.floor(e * 10) / 10 : Math.floor(e)
}
