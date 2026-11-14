'use client'

import { useEffect, useState } from 'react'

export function useSettledValue(value: number, delaySeconds: number, from = 0): number {
    const [shown, setShown] = useState(from)

    useEffect(() => {
        const timer = setTimeout(() => setShown(value), delaySeconds * 1000)
        return () => clearTimeout(timer)
    }, [value, delaySeconds])

    return shown
}
