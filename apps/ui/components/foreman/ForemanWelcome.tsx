'use client'

import { motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { Orb } from '@/components/foreman/Orb'
import { WELCOME_ORB_SIZE } from '@/components/foreman/constants'

const EASE = [0.22, 1, 0.36, 1] as const

export function ForemanWelcome({ thinking, title, subtitle }: { thinking?: boolean; title?: string; subtitle?: string }) {
    const t = useTranslations('foreman.welcome')
    const reducedMotion = useReducedMotion()
    const enter = (delay: number) => ({
        initial: reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(8px)' },
        animate: reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' },
        transition: reducedMotion ? { duration: 0 } : { duration: 0.38, ease: EASE, delay },
    })

    return (
        <motion.div
            className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 p-8 text-center"
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
        >
            <motion.div {...enter(0)}>
                <Orb size={WELCOME_ORB_SIZE} state={thinking ? 'thinking' : 'idle'} />
            </motion.div>

            <motion.div className="space-y-1" {...enter(0.12)}>
                <h3 className="font-medium text-sm">{title ?? t('title')}</h3>
                {subtitle ? <p className="text-muted-foreground text-sm text-balance">{subtitle}</p> : <Shimmer className="text-sm">{t('preparing')}</Shimmer>}
            </motion.div>
        </motion.div>
    )
}
