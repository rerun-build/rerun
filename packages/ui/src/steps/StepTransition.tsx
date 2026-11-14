'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

export const STEP_TRANSITION = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const

const bodyVariants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * 20 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir * -20 }),
}

const headerVariants = {
    enter: (dir: number) => ({ opacity: 0, y: dir * 6 }),
    center: { opacity: 1, y: 0 },
    exit: (dir: number) => ({ opacity: 0, y: dir * -6 }),
}

const VARIANTS = { body: bodyVariants, header: headerVariants }

export function StepTransition({ stepKey, direction, variant = 'body', className, children }: { stepKey: string | number; direction: number; variant?: 'body' | 'header'; className?: string; children: ReactNode }) {
    return (
        <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div key={stepKey} custom={direction} variants={VARIANTS[variant]} initial="enter" animate="center" exit="exit" transition={STEP_TRANSITION} className={className}>
                {children}
            </motion.div>
        </AnimatePresence>
    )
}
