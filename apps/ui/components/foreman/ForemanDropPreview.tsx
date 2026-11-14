'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { FLOAT_CORNER_CLASSES, FLOAT_SIZE_CLASSES, floatSizeStyle } from '@/components/foreman/placement-classes'
import type { ForemanPlacement } from '@/lib/foreman-layout'
import { cn } from '@/lib/utils'
import { useForemanStore } from '@/stores/foreman.store'

function targetClasses(target: ForemanPlacement): string {
    if (target.mode === 'dock') return cn('md:inset-y-2 md:w-[calc(var(--foreman-dock-track)-8px)]', target.side === 'left' ? 'md:left-2' : 'md:right-2')
    return cn(FLOAT_SIZE_CLASSES, FLOAT_CORNER_CLASSES[target.corner])
}

export function ForemanDropPreview() {
    const target = useForemanStore(state => state.dropTarget)
    const reduceMotion = useReducedMotion()

    return (
        <AnimatePresence>
            {target && (
                <motion.div
                    aria-hidden
                    layout={!reduceMotion}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
                    style={{ ...(target.mode === 'float' ? floatSizeStyle(target) : null), borderRadius: 14 }}
                    className={cn('pointer-events-none fixed z-40 hidden border-2 border-primary/40 bg-primary/5 md:block', targetClasses(target))}
                />
            )}
        </AnimatePresence>
    )
}
