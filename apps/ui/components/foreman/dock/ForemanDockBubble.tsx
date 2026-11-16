'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { BorderBeam, type BorderBeamProps } from '@rerun/ui'

import type { ForemanCorner } from '@/lib/foreman-layout'
import { cn } from '@/lib/utils'

// The card sits on the screen side of the ball and its tail points back at the ball's centre,
// 28px in from the edge the two share.
const PLACEMENT: Record<ForemanCorner, string> = {
    'top-left': 'top-full left-0 mt-4',
    'top-right': 'top-full right-0 mt-4',
    'bottom-left': 'bottom-full left-0 mb-4',
    'bottom-right': 'right-0 bottom-full mb-4',
}

const TAIL: Record<ForemanCorner, string> = {
    'top-left': '-top-[7px] left-[22px] border-t border-l',
    'top-right': '-top-[7px] right-[22px] border-t border-l',
    'bottom-left': '-bottom-[7px] left-[22px] border-r border-b',
    'bottom-right': '-bottom-[7px] right-[22px] border-r border-b',
}

type ForemanDockBubbleProps = { corner: ForemanCorner; tone?: BorderBeamProps['tone']; children: ReactNode }

/** What the parked Foreman holds up above its pill: a question it stopped on, or its answer. */
export function ForemanDockBubble({ corner, tone, children }: ForemanDockBubbleProps) {
    const reducedMotion = useReducedMotion()
    const rise = corner.startsWith('bottom') ? 6 : -6
    const away = reducedMotion ? { opacity: 0 } : { opacity: 0, y: rise }

    return (
        <motion.div
            initial={away}
            animate={{ opacity: 1, y: 0 }}
            exit={away}
            transition={{ duration: reducedMotion ? 0 : 0.24, ease: 'easeOut' }}
            className={cn('group/bubble pointer-events-auto absolute w-80 rounded-xl border border-border bg-card text-sm text-foreground shadow-2xl has-[[data-bubble-surface]:hover]:[--bubble-tail:var(--color-accent)]', PLACEMENT[corner])}
        >
            {tone && <BorderBeam pattern="arcs" tone={tone} animated glow width={1} duration={4} />}
            <span aria-hidden className={cn('absolute size-3 rotate-45 border-border bg-[var(--bubble-tail,var(--color-card))] transition-colors', TAIL[corner])} />
            <div className="relative rounded-[inherit]">{children}</div>
        </motion.div>
    )
}
