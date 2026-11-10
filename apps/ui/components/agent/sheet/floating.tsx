'use client'

import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const SURFACE_EASE = [0.22, 1, 0.36, 1] as const

/**
 * Under what floats over the thread: it stays readable, but clearly behind, so a pill is never mistaken for a message.
 * `tall` reaches below the row of open conversations, so a tab never sits on a message either. It overlaps the top of the
 * thread, so it only shows once the conversation has scrolled: at rest the first message stays sharp.
 */
export function TopVeil({ tall = false }: { tall?: boolean }) {
    return (
        <div
            className={cn(
                'pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-background via-background/85 to-transparent backdrop-blur-[3px]',
                tall
                    ? 'h-40 opacity-0 transition-opacity duration-200 [mask-image:linear-gradient(to_bottom,black_60%,transparent)] [:not(.hidden):has([data-chat-scrolled])~&]:opacity-100'
                    : 'h-28 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]'
            )}
        />
    )
}

export function Scrim({ onClose }: { onClose: () => void }) {
    const t = useTranslations('agent.floating')
    return (
        <motion.button
            type="button"
            aria-label={t('backToChat')}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: SURFACE_EASE }}
            className="absolute inset-0 z-30 bg-foreground/5 backdrop-blur-[2px]"
        />
    )
}

/** Lands under the pill that opened it and leaves the way it came. `receded` leaves it in place, behind what it opened. */
export function FloatingSurface({ receded = false, className, children }: { receded?: boolean; className?: string; children: ReactNode }) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={receded ? { opacity: 0.35, scale: 0.97, y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: receded ? 0.5 : 0.26, ease: SURFACE_EASE }}
            style={{ transformOrigin: 'top center' }}
            className={cn('absolute z-40 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl', receded && 'pointer-events-none', className)}
        >
            {children}
        </motion.div>
    )
}

export function FloatingPill({ label, onClick, active = false, className, children }: { label: string; onClick: () => void; active?: boolean; className?: string; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-expanded={active}
            onClick={onClick}
            className={cn(
                'flex h-10 items-center gap-2 rounded-full border border-border/50 bg-background/85 px-3 text-sm shadow-sm backdrop-blur-xl transition-colors hover:bg-accent',
                active && 'border-primary/40 ring-1 ring-primary/40',
                className
            )}
        >
            {children}
        </button>
    )
}
