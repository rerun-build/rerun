'use client'

import { motion, type Transition } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '../cn'

export const SIZE_TRANSITION: Transition = { duration: 0.28, ease: [0.4, 0, 0.2, 1] }

type Size = { width: number; height: number }

// The size is measured rather than left to `auto`: `auto` cannot be interpolated, and motion's
// `layout` projects the content while it runs, which stretches the text of the step coming in. Here
// only the frame moves, its content stays sharp from start to finish.
// With `axis="both"` the content sets its own width (`w-max`), the frame follows it.
export function AnimatedSize({
    children,
    axis = 'height',
    transition = SIZE_TRANSITION,
    className,
    innerClassName,
}: {
    children: ReactNode
    axis?: 'height' | 'both'
    transition?: Transition
    className?: string
    innerClassName?: string
}) {
    const inner = useRef<HTMLDivElement>(null)
    // `null` until measured: the first size is the content's own, not an animation from zero.
    const [size, setSize] = useState<Size | null>(null)

    useLayoutEffect(() => {
        const element = inner.current
        if (!element) return
        const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight })
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        measure()
        return () => observer.disconnect()
    }, [])

    const target = size === null ? undefined : axis === 'both' ? size : { height: size.height }

    return (
        <motion.div animate={target} initial={false} transition={transition} className={className} style={{ overflow: 'hidden' }}>
            <div ref={inner} className={cn(axis === 'both' && 'w-max', innerClassName)}>
                {children}
            </div>
        </motion.div>
    )
}
