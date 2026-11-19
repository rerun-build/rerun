'use client'

import { cn } from '@/lib/utils'
import { STEP_TRANSITION } from '@moldwright/ui/steps'
import { TourScene } from '@moldwright/ui/tour'
import { motion } from 'motion/react'

const TITLE_BAND = 210
const TITLE_SCRIM = `linear-gradient(to bottom, var(--popover) 0px, color-mix(in oklab, var(--popover) 76%, transparent) 96px, color-mix(in oklab, var(--popover) 0%, transparent) ${TITLE_BAND}px)`

export function TourBoard({ phase, active, className }: { phase: number; active: boolean; className?: string }) {
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={STEP_TRANSITION} className={cn('relative', className)}>
            <TourScene phase={phase} active={active} bandTop={TITLE_BAND} className="size-full" />
            <div style={{ height: TITLE_BAND, backgroundImage: TITLE_SCRIM }} className="pointer-events-none absolute inset-x-0 top-0" />
        </motion.div>
    )
}
