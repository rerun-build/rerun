'use client'

import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Icon } from '@/components/ui/icon'
import { BrainIcon } from '@/lib/icons'
import { RewindCount } from '../RewindCount'
import { RewindHeadline, RewindReveal, RewindSlideFrame } from '../RewindSlideFrame'
import type { RewindSlideProps } from './types'

export function MemorySlide({ payload, agentName }: RewindSlideProps) {
    const t = useTranslations('rewind.memory')
    const { memoriesCreated } = payload.totals
    const memory = payload.topMemory
    const words = memory?.content.split(' ') ?? []

    return (
        <RewindSlideFrame
            tone="blue"
            eyebrow={t('eyebrow')}
            visual={
                memory && (
                    <>
                        <RewindReveal delay={1} className="mb-2 text-xs font-medium tracking-wider text-white/70 uppercase">
                            {t('recalled', { count: memory.accessCount, name: agentName(memory.agentId) })}
                        </RewindReveal>
                        <blockquote className="rounded-2xl bg-black/25 p-5 text-xl leading-snug font-medium backdrop-blur-sm rewind-wide:p-8 rewind-wide:text-[min(1.875rem,5.5cqh)]">
                            {words.map((word, i) => (
                                <motion.span key={i} initial={{ opacity: 0, filter: 'blur(4px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ delay: 1.3 + i * 0.04, duration: 0.3 }}>
                                    {word}{' '}
                                </motion.span>
                            ))}
                        </blockquote>
                    </>
                )
            }
        >
            <motion.div
                className="mb-5 w-fit"
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: [0, 1.15, 1], rotate: 0 }}
                transition={{ duration: 0.7, delay: 0.1 }}
            >
                <Icon icon={BrainIcon} size="xl" tone="white" />
            </motion.div>
            {memoriesCreated > 0 ? (
                <RewindHeadline>{t.rich('headline', { count: memoriesCreated, value: () => <RewindCount value={memoriesCreated} delay={0.4} /> })}</RewindHeadline>
            ) : (
                <RewindHeadline>{t('empty')}</RewindHeadline>
            )}
        </RewindSlideFrame>
    )
}
