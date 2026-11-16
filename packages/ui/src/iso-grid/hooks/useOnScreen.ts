'use client'

import { type RefObject, useEffect, useState } from 'react'

import { usePageUnattended } from '../../primitives/use-page-unattended'

// Vrai tant que l'élément peut être vu : dans le viewport, onglet affiché, et quelqu'un devant la
// page. Vrai avant la première mesure, pour ne jamais figer le premier paint d'un board qui est en
// fait à l'écran.
export function useOnScreen(ref: RefObject<Element | null>): boolean {
    const [intersecting, setIntersecting] = useState(true)
    const [tabVisible, setTabVisible] = useState(true)
    const unattended = usePageUnattended()

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

    return intersecting && tabVisible && !unattended
}
