'use client'

import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

const HEIGHT_TRANSITION = { duration: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }

export function AnimatedHeight({ children, className }: { children: ReactNode; className?: string }) {
    const inner = useRef<HTMLDivElement>(null)
    const [height, setHeight] = useState<number | null>(null)

    useLayoutEffect(() => {
        const element = inner.current
        if (!element) return
        const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
        observer.observe(element)
        setHeight(element.offsetHeight)
        return () => observer.disconnect()
    }, [])

    return (
        <motion.div animate={height === null ? undefined : { height }} initial={false} transition={HEIGHT_TRANSITION} className={cn('-m-1', className)} style={{ overflow: 'hidden' }}>
            <div ref={inner} className="p-1">
                {children}
            </div>
        </motion.div>
    )
}
