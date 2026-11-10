'use client'

import type { RewindAwardId } from '@rerun/contracts'
import type { BorderBeamProps } from '@rerun/ui'
import { Card } from '@rerun/ui/primitives'
import { motion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'

import { Icon } from '@/components/ui/icon'

import { formatDuration } from '@/lib/rewind/format'
import { cn } from '@/lib/utils'
import { HandshakeIcon, MoonStar, PlugIcon, ShieldCheck, TimerIcon, WrenchIcon, type LucideIcon } from '@/lib/icons'
import { RewindHeadline, RewindSlideFrame } from '../RewindSlideFrame'
import type { RewindSlideProps } from './types'

const AWARDS: Record<RewindAwardId, { icon: LucideIcon; tone: NonNullable<BorderBeamProps['tone']>; color: string }> = {
    'night-owl': { icon: MoonStar, tone: 'brand', color: '#b7a8ff' },
    marathon: { icon: TimerIcon, tone: 'orange', color: '#ff8a1f' },
    flawless: { icon: ShieldCheck, tone: 'green', color: '#a3ff3f' },
    toolsmith: { icon: WrenchIcon, tone: 'cyan', color: '#38d4ff' },
    'connector-hub': { icon: PlugIcon, tone: 'yellow', color: '#ffd23f' },
    'team-player': { icon: HandshakeIcon, tone: 'red', color: '#ff3fa4' },
}

export function AwardsSlide({ payload, agentName }: RewindSlideProps) {
    const locale = useLocale()
    const t = useTranslations('rewind.awards')
    return (
        <RewindSlideFrame
            tone="ink"
            eyebrow={t('eyebrow')}
            visual={
                <div className={cn('grid grid-cols-2 gap-3', payload.awards.length > 4 && 'rewind-wide:grid-cols-3')}>
                    {payload.awards.map((award, i) => {
                        const meta = AWARDS[award.id]
                        return (
                            <motion.div
                                key={award.id}
                                className="[perspective:600px]"
                                initial={{ opacity: 0, rotateY: 90 }}
                                animate={{ opacity: 1, rotateY: 0 }}
                                transition={{ duration: 0.6, delay: 0.6 + i * 0.35, ease: [0.22, 1, 0.36, 1] }}
                            >
                                <Card size="sm" className="h-full gap-0 bg-card/70 px-3 backdrop-blur-sm">
                                    <Icon icon={meta.icon} tone={meta.tone} size="sm" />
                                    <p className="mt-3 text-sm font-semibold">{t(`${award.id}.title`)}</p>
                                    <p className="truncate text-base font-medium" style={{ color: meta.color }}>
                                        {agentName(award.agentId)}
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">{t(`${award.id}.caption`, { count: award.value, duration: formatDuration(award.value, locale) })}</p>
                                </Card>
                            </motion.div>
                        )
                    })}
                </div>
            }
        >
            <RewindHeadline>{t('headline')}</RewindHeadline>
        </RewindSlideFrame>
    )
}
