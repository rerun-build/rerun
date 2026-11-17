'use client'

import { cn } from '@/lib/utils'
import { motion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Phase = 'in' | 'out' | 'resize'

const FADE_OUT_S = 0.12
const FADE_IN_S = 0.16
const RESIZE_MIN_S = 0.12
const RESIZE_MAX_S = 0.3
// Pixels per second of resize: a step of nearly the same height barely waits, a much taller one
// takes the full beat, so the surface never sits blank longer than the change warrants.
const RESIZE_SPEED = 1400

// Three beats on a change of step: the content fades out, the surface takes the next step's height,
// the next step fades in. Within a step (a card appearing under a field) the height simply follows.
export function StepSwap({ stepKey, children, className, innerClassName }: { stepKey: string; children: ReactNode; className?: string; innerClassName?: string }) {
    const [shownKey, setShownKey] = useState(stepKey)
    const [phase, setPhase] = useState<Phase>('in')
    const [height, setHeight] = useState<number | null>(null)
    const [resizeSeconds, setResizeSeconds] = useState(RESIZE_MIN_S)
    const inner = useRef<HTMLDivElement>(null)
    const leaving = useRef<ReactNode>(children)
    const lastHeight = useRef<number | null>(null)

    if (stepKey === shownKey) leaving.current = children
    if (stepKey !== shownKey && phase === 'in') setPhase('out')

    useLayoutEffect(() => {
        const element = inner.current
        if (!element) return
        const observer = new ResizeObserver(() => {
            lastHeight.current = element.offsetHeight
            setHeight(element.offsetHeight)
        })
        observer.observe(element)
        lastHeight.current = element.offsetHeight
        setHeight(element.offsetHeight)
        return () => observer.disconnect()
    }, [])

    useLayoutEffect(() => {
        if (phase !== 'resize' || !inner.current) return
        const next = inner.current.offsetHeight
        const delta = Math.abs(next - (height ?? next))
        if (delta < 2) {
            setPhase('in')
            return
        }
        setResizeSeconds(Math.min(RESIZE_MAX_S, Math.max(RESIZE_MIN_S, delta / RESIZE_SPEED)))
        setHeight(next)
        // Only the change of key reruns this: the height it reads is the one before the swap.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, shownKey])

    const content = stepKey === shownKey ? children : leaving.current

    return (
        <motion.div
            className={cn('overflow-hidden', className)}
            initial={false}
            animate={height === null ? undefined : { height }}
            transition={{ duration: phase === 'resize' ? resizeSeconds : 0.2, ease: [0.4, 0, 0.2, 1] }}
            onAnimationComplete={() => {
                if (phase === 'resize') setPhase('in')
            }}
        >
            <motion.div
                ref={inner}
                className={innerClassName}
                initial={false}
                animate={{ opacity: phase === 'in' ? 1 : 0 }}
                transition={{ duration: phase === 'out' ? FADE_OUT_S : FADE_IN_S, ease: 'easeOut' }}
                onAnimationComplete={() => {
                    if (phase !== 'out') return
                    setShownKey(stepKey)
                    setPhase('resize')
                }}
            >
                {content}
            </motion.div>
        </motion.div>
    )
}
