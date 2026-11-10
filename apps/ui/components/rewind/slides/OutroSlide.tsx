'use client'

import { Badge, Card } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { fireRerunConfetti } from '@/lib/confetti'
import { formatWeekRange, formatWorked } from '@/lib/rewind/format'
import { cn } from '@/lib/utils'
import { RewindCount } from '../RewindCount'
import { RewindHeadline, RewindReveal, RewindSlideFrame } from '../RewindSlideFrame'
import type { RewindSlideProps } from './types'

export function OutroSlide({ payload, agentName, onReplay, onClose }: RewindSlideProps) {
    const locale = useLocale()
    const t = useTranslations('rewind.outro')
    const worked = formatWorked(payload.totals.workedMs)

    useEffect(() => {
        const timer = setTimeout(() => void fireRerunConfetti(), 500)
        return () => clearTimeout(timer)
    }, [])

    const stats = [
        { id: 'runs', label: t('stats.runs'), value: payload.totals.runs },
        { id: 'worked', label: worked.unit === 'hours' ? t('stats.hoursWorked') : t('stats.minutesWorked'), value: worked.value },
        { id: 'toolCalls', label: t('stats.toolCalls'), value: payload.totals.toolCalls },
        { id: 'appsUsed', label: t('stats.appsUsed'), value: payload.connectors.length },
    ]

    return (
        <RewindSlideFrame
            tone="violet"
            eyebrow={t('eyebrow')}
            visual={
                <>
                    <RewindReveal delay={0.5}>
                        <Card className="gap-0 px-5 py-5 shadow-2xl shadow-black/40 rewind-wide:px-8 rewind-wide:py-8">
                            <Badge tone="brand" size="xs" className="mb-2 self-start">
                                Rerun Rewind
                            </Badge>
                            <p className="text-sm text-muted-foreground">{formatWeekRange(payload.weekStart, payload.weekEnd, locale)}</p>
                            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rewind-wide:mt-6 rewind-wide:gap-y-5">
                                {stats.map((stat, i) => (
                                    <div key={stat.id}>
                                        <RewindCount value={stat.value} delay={0.8 + i * 0.1} className="text-3xl font-semibold tracking-tight rewind-wide:text-4xl" />
                                        <p className="text-xs text-muted-foreground">{stat.label}</p>
                                    </div>
                                ))}
                            </div>
                            {payload.mvpAgentId && (
                                <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
                                    {t.rich('mvp', { name: agentName(payload.mvpAgentId), b: chunks => <span className="font-semibold text-foreground">{chunks}</span> })}
                                </p>
                            )}
                        </Card>
                    </RewindReveal>
                    <OutroActions onReplay={onReplay} onClose={onClose} className="mt-5 rewind-wide:hidden" />
                </>
            }
        >
            <RewindHeadline className="text-[2.5rem]/[1.05] rewind-wide:text-[min(4rem,12cqh)]/[1.02]">{t('headline')}</RewindHeadline>
            <OutroActions onReplay={onReplay} onClose={onClose} className="hidden rewind-wide:mt-8 rewind-wide:flex" />
        </RewindSlideFrame>
    )
}

// Sits under the recap card on a portrait story and under the headline on a wide one.
function OutroActions({ onReplay, onClose, className }: { onReplay: () => void; onClose: () => void; className?: string }) {
    const t = useTranslations('rewind.outro')
    return (
        <RewindReveal delay={1.2} className={cn('flex gap-2', className)}>
            <Button variant="outline" className="flex-1" onClick={onReplay}>
                {t('watchAgain')}
            </Button>
            <Button className="flex-1" onClick={onClose}>
                {t('backToBoard')}
            </Button>
        </RewindReveal>
    )
}
