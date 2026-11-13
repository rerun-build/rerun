'use client'

import { motion, useIsPresent } from 'motion/react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import type { CardDestination, CardDestinationShape } from '@/components/agent/sheet/AgentCard'
import { SURFACE_EASE } from '@/components/agent/sheet/floating'

type Size = { width: number; height: number }

/** The button a screen was opened from, measured in the panel's body: the screen grows out of it and folds back into it. */
export type CardOrigin = { tab: CardDestination; shape: CardDestinationShape; top: number; left: number; width: number; height: number; panel: Size }

export function measureCardOrigin(tab: CardDestination, shape: CardDestinationShape, element: HTMLElement): CardOrigin {
    const body = element.closest('[data-side-panel-body]')!
    const panel = body.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    return { tab, shape, top: rect.top - panel.top, left: rect.left - panel.left, width: rect.width, height: rect.height, panel: { width: body.clientWidth, height: body.clientHeight } }
}

const transition = (duration: number, delay = 0) => ({ duration, delay, ease: SURFACE_EASE })

/**
 * The clicked button opens up from its exact place until it fills the panel, then folds back into
 * it on the way out. Its edges move, nothing is scaled: the screen inside already has its final
 * size, the surface uncovers it as it grows instead of laying it out again on every frame.
 */
export function AgentViewExpander({ origin, ghost, onGrown, children }: { origin: CardOrigin; ghost: ReactNode; onGrown: () => void; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    const isPresent = useIsPresent()
    const [size, setSize] = useState<Size>(origin.panel)
    const from = { top: origin.top, left: origin.left, width: origin.width, height: origin.height, borderRadius: 10 }

    // The mobile sheet is dragged between detents and the desktop panel resized while a screen is open.
    useLayoutEffect(() => {
        const body = ref.current?.parentElement
        if (!body) return
        const observer = new ResizeObserver(() => setSize({ width: body.clientWidth, height: body.clientHeight }))
        observer.observe(body)
        return () => observer.disconnect()
    }, [])

    return (
        <motion.div
            ref={ref}
            initial={from}
            animate={{ top: 0, left: 0, width: size.width, height: size.height, borderRadius: 0 }}
            exit={from}
            transition={transition(0.5)}
            onAnimationComplete={() => isPresent && onGrown()}
            className="absolute z-[60] overflow-hidden bg-background shadow-2xl ring-1 ring-border"
        >
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: transition(0.3, 0.12) }}
                exit={{ opacity: 0, transition: transition(0.15) }}
                className="absolute left-0 top-0 flex flex-col"
                style={size}
            >
                {children}
            </motion.div>
            <motion.div
                initial={{ opacity: 1 }}
                animate={{ opacity: 0, transition: transition(0.18, 0.04) }}
                exit={{ opacity: 1, transition: transition(0.2, 0.25) }}
                className="pointer-events-none absolute inset-x-0 top-0"
                style={{ height: origin.height }}
            >
                {ghost}
            </motion.div>
        </motion.div>
    )
}
