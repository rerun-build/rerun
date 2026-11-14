'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Orb } from '@/components/foreman/Orb'
import { WELCOME_ORB_SIZE } from '@/components/foreman/constants'
import type { ForemanArrival } from '@/lib/foreman/phase'
import type { ForemanIntakeController } from './useForemanIntake'

const EASE = [0.22, 1, 0.36, 1] as const

export function ForemanIntakeHeader({ intake, arrival = null }: { intake: ForemanIntakeController; arrival?: ForemanArrival | null }) {
    const t = useTranslations('foreman.intake')
    const still = useReducedMotion()

    const enter = (delay: number) => ({
        initial: still ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(8px)' },
        animate: still ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' },
        transition: still ? { duration: 0 } : { duration: 0.38, ease: EASE, delay },
    })

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center justify-end gap-5 px-8 pb-6 text-center">
            <motion.div {...enter(0)}>
                <Orb size={WELCOME_ORB_SIZE} state={intake.submitting || intake.deciding ? 'thinking' : 'listening'} />
            </motion.div>

            {arrival && (
                <motion.p {...enter(0.04)} className="text-muted-foreground text-xs">
                    {t.rich('settingUp', { title: arrival.title, highlight: chunks => <span className="text-foreground">{chunks}</span> })}
                </motion.p>
            )}

            <div className="grid min-h-[5.25rem] w-full max-w-[22rem] items-start">
                <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div key={intake.step} {...enter(0.08)} exit={still ? { opacity: 0 } : { opacity: 0, y: -8, filter: 'blur(6px)' }} className="col-start-1 row-start-1 space-y-1.5">
                        <h3 className="font-medium text-base">{t(`steps.${intake.step}.title`)}</h3>
                        <p className="text-muted-foreground text-sm">{t(`steps.${intake.step}.description`)}</p>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}
