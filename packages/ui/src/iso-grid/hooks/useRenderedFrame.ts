'use client'

import { useEffect, useRef, useState } from 'react'

export type RenderedFrame = { width: number; height: number }

export function useRenderedFrame() {
    const ref = useRef<HTMLDivElement>(null)
    const [frame, setFrame] = useState<RenderedFrame | null>(null)

    useEffect(() => {
        const element = ref.current
        if (!element) return
        const measure = () => {
            const { clientWidth, clientHeight } = element
            if (clientWidth > 0 && clientHeight > 0) setFrame({ width: clientWidth, height: clientHeight })
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    return { ref, frame }
}
