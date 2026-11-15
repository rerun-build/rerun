'use client'

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false)

    useEffect(() => {
        const mql = window.matchMedia(QUERY)
        setReduced(mql.matches)
        const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
        mql.addEventListener('change', onChange)
        return () => mql.removeEventListener('change', onChange)
    }, [])

    return reduced
}
