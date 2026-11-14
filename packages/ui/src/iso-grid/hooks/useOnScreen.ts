'use client'

import { type RefObject, useEffect, useState } from 'react'

export function useOnScreen(ref: RefObject<Element | null>): boolean {
    const [intersecting, setIntersecting] = useState(true)
    const [tabVisible, setTabVisible] = useState(true)

    useEffect(() => {
        const element = ref.current
        if (!element) return
        const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting))
        observer.observe(element)
        return () => observer.disconnect()
    }, [ref])

    useEffect(() => {
        const sync = () => setTabVisible(document.visibilityState !== 'hidden')
        sync()
        document.addEventListener('visibilitychange', sync)
        return () => document.removeEventListener('visibilitychange', sync)
    }, [])

    return intersecting && tabVisible
}
