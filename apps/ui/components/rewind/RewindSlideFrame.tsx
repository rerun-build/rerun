'use client'

import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { RewindBackdrop, type RewindBackdropShape } from './RewindBackdrop'

export type RewindTone = 'violet' | 'blue' | 'magenta' | 'lime' | 'amber' | 'ink'

const TONES: Record<RewindTone, { base: string; colors: string[]; shape: RewindBackdropShape }> = {
    violet: { base: '#120a3a', colors: ['#4d34f7', '#b7a8ff', '#2a1a9e'], shape: 'corners' },
    blue: { base: '#04132e', colors: ['#1f6bff', '#38d4ff', '#123a8f'], shape: 'wave' },
    magenta: { base: '#2a0626', colors: ['#ff3fa4', '#8a3cff', '#ff9a5a'], shape: 'ripple' },
    lime: { base: '#0b1a07', colors: ['#7fd13b', '#1f9e5a', '#123d16'], shape: 'truchet' },
    amber: { base: '#140802', colors: ['#ffb020', '#c2410c', '#ff5a1f'], shape: 'corners' },
    ink: { base: '#0a0a0a', colors: ['#4d34f7', '#3a3a3a', '#b7a8ff'], shape: 'dots' },
}

export function RewindSlideFrame({ tone, eyebrow, children, visual, centered = false, className }: { tone: RewindTone; eyebrow?: string; children: ReactNode; visual?: ReactNode; centered?: boolean; className?: string }) {
    const palette = TONES[tone]
    const split = Boolean(visual) && !centered

    return (
        <div className="absolute inset-0 overflow-hidden text-white" style={{ background: palette.base }}>
            <RewindBackdrop base={palette.base} colors={palette.colors} shape={palette.shape} />
            <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/55 via-black/15 to-black/75 rewind-wide:bg-linear-to-r rewind-wide:from-black/65 rewind-wide:via-black/30 rewind-wide:to-black/45" />
            <div
                className={cn(
                    'relative flex h-full flex-col px-6 pt-24 pb-8 rewind-wide:px-14 rewind-wide:pt-24 rewind-wide:pb-14',
                    centered && 'justify-center rewind-wide:px-20',
                    !visual && 'rewind-wide:justify-center',
                    split && 'rewind-wide:grid rewind-wide:grid-cols-[5fr_7fr] rewind-wide:grid-rows-[minmax(0,1fr)] rewind-wide:gap-14',
                    className
                )}
            >
                <div className={cn('flex flex-col', split && 'rewind-wide:justify-center')}>
                    {eyebrow && (
                        <motion.p
                            className="mb-3 text-xs font-medium tracking-[0.2em] text-white/70 uppercase rewind-wide:text-sm"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: 0.1 }}
                        >
                            {eyebrow}
                        </motion.p>
                    )}
                    {children}
                </div>
                {visual && <div className={cn('flex min-h-0 flex-col', split && 'mt-auto pt-6 rewind-wide:mt-0 rewind-wide:justify-center rewind-wide:pt-0')}>{visual}</div>}
            </div>
        </div>
    )
}

export function RewindHeadline({ children, delay = 0.2, className }: { children: ReactNode; delay?: number; className?: string }) {
    return (
        <motion.h2
            className={cn('text-[2rem]/[1.1] font-semibold rewind-wide:text-[2.75rem]/[1.05] tracking-tight text-balance [&_number-flow-react]:leading-none [&_number-flow-react]:[--number-flow-mask-height:0px]', className)}
            initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
        >
            {children}
        </motion.h2>
    )
}

export function RewindReveal({ children, delay, className }: { children: ReactNode; delay: number; className?: string }) {
    return (
        <motion.div className={className} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}>
            {children}
        </motion.div>
    )
}
