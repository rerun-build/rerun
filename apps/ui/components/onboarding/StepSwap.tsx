'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
const FADE_OUT = { duration: 0.14, ease: 'easeIn' } as const
const FADE_IN = { duration: 0.22, ease: 'easeOut' } as const
const RESIZE_S = 0.3
// A surface that barely changes height should not keep the user waiting on an empty frame: the
// resize takes the time its distance needs, between these two.
const RESIZE_MIN_S = 0.12
const PX_PER_S = 700

function resizeDuration(distance: number): number {
    return Math.min(RESIZE_S, Math.max(RESIZE_MIN_S, distance / PX_PER_S))
}

type Phase = 'idle' | 'out' | 'resize' | 'in'
type Rendered = { key: string; node: ReactNode }

// A surface whose step changes in three beats: what is on it fades out, the surface takes the height
// of the next step, then the next step fades in. Only the surface moves while it resizes, so neither
// step is ever squeezed or cut. Within a step the surface follows its content's height on its own.
//
// `contentKey` remounts the content without the three beats, for a change that stays on the same step.
export function StepSwap({ stepKey, contentKey = stepKey, children, className }: { stepKey: string; contentKey?: string; children: ReactNode; className?: string }) {
    const reduceMotion = useReducedMotion()
    const [phase, setPhase] = useState<Phase>('idle')
    const [shownStep, setShownStep] = useState(stepKey)
    const [leaving, setLeaving] = useState<Rendered | null>(null)
    const [height, setHeight] = useState<number | null>(null)
    const [resizeS, setResizeS] = useState(RESIZE_S)
    const inner = useRef<HTMLDivElement>(null)
    const lastRendered = useRef<Rendered>({ key: contentKey, node: children })

    if (stepKey !== shownStep && phase !== 'out') {
        if (reduceMotion) {
            setShownStep(stepKey)
        } else {
            // What was on screen the commit before, captured in the render that changes step: the next
            // step must not paint for a frame before the old one fades out.
            // eslint-disable-next-line react-hooks/refs
            setLeaving(lastRendered.current)
            setPhase('out')
        }
    }

    const rendered: Rendered = phase === 'out' && leaving ? leaving : { key: contentKey, node: children }

    useLayoutEffect(() => {
        lastRendered.current = rendered
    })

    useLayoutEffect(() => {
        const element = inner.current
        if (!element) return
        const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
        observer.observe(element)
        setHeight(element.offsetHeight)
        return () => observer.disconnect()
    }, [])

    // The next step is in place, still invisible: the surface goes to its height, and it only shows
    // once the surface got there. A step of the same height shows at once.
    const heightBefore = useRef<number | null>(null)
    useLayoutEffect(() => {
        if (phase !== 'resize' || !inner.current) return
        const next = inner.current.offsetHeight
        const distance = heightBefore.current === null ? 0 : Math.abs(next - heightBefore.current)
        const duration = resizeDuration(distance)
        setResizeS(duration)
        setHeight(next)
        const timer = setTimeout(() => setPhase('in'), distance > 1 ? duration * 1000 : 0)
        return () => clearTimeout(timer)
    }, [phase])

    useEffect(() => {
        if (phase === 'out') heightBefore.current = inner.current?.offsetHeight ?? null
    }, [phase])

    const settleOpacity = () => {
        if (phase === 'out') {
            setLeaving(null)
            setShownStep(stepKey)
            setPhase('resize')
        } else if (phase === 'in') {
            setPhase('idle')
            setResizeS(RESIZE_S)
        }
    }

    const hidden = phase === 'out' || phase === 'resize'

    return (
        <motion.div data-step-swap initial={false} animate={height === null ? undefined : { height }} transition={{ duration: resizeS, ease: EASE }} style={{ overflow: 'hidden' }} className={cn('shrink-0', className)}>
            <motion.div ref={inner} initial={false} animate={{ opacity: hidden ? 0 : 1 }} transition={phase === 'out' ? FADE_OUT : FADE_IN} onAnimationComplete={settleOpacity}>
                <Fragment key={rendered.key}>{rendered.node}</Fragment>
            </motion.div>
        </motion.div>
    )
}
