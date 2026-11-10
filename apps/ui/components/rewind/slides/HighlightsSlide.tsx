'use client'

import { Badge, Card } from '@rerun/ui/primitives'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { RewindHeadline, RewindSlideFrame } from '../RewindSlideFrame'
import type { RewindSlideProps } from './types'

const CARD_TILTS = [-2.5, 2, -1.5]

export function HighlightsSlide({ payload, agentName }: RewindSlideProps) {
    const t = useTranslations('rewind.highlights')
    return (
        <RewindSlideFrame
            tone="violet"
            eyebrow={t('eyebrow')}
            visual={
                <div className="flex flex-col gap-3 rewind-wide:gap-4">
                    {payload.highlights.map((highlight, i) => (
                        <motion.div
                            key={`${highlight.agentId}-${i}`}
                            initial={{ opacity: 0, y: 60, rotate: 0, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, rotate: CARD_TILTS[i % CARD_TILTS.length], scale: 1 }}
                            transition={{ type: 'spring', stiffness: 140, damping: 16, delay: 0.6 + i * 0.9 }}
                        >
                            <Card className="gap-1 px-4 shadow-2xl shadow-black/30">
                                <Badge tone="brand" size="xs" className="mb-1 self-start">
                                    {agentName(highlight.agentId)}
                                </Badge>
                                <p className="text-xl leading-tight font-semibold tracking-tight">{highlight.headline}</p>
                                <p className="text-sm text-muted-foreground">{highlight.detail}</p>
                            </Card>
                        </motion.div>
                    ))}
                </div>
            }
        >
            <RewindHeadline>{t('headline')}</RewindHeadline>
        </RewindSlideFrame>
    )
}
