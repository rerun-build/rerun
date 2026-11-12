'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { FLOAT_CORNER_CLASSES, FLOAT_SIZE_CLASSES, floatSizeStyle } from '@/components/foreman/placement-classes'
import type { ForemanPlacement } from '@/lib/foreman-layout'
import { cn } from '@/lib/utils'
import { useForemanStore } from '@/stores/foreman.store'

/** Les bandes de dock reprennent la piste moins la gouttière `md:p-2` qui la borde côté board. */
function targetClasses(target: ForemanPlacement): string {
    if (target.mode === 'dock') return cn('md:inset-y-2 md:w-[calc(var(--foreman-dock-track)-8px)]', target.side === 'left' ? 'md:left-[calc(var(--board-inset-left)-1px)]' : 'md:right-2')
    return cn(FLOAT_SIZE_CLASSES, FLOAT_CORNER_CLASSES[target.corner])
}

/** Le fantôme de la place où la colonne tenue par son en-tête atterrira si on la lâche. */
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
