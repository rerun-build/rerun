'use client'

import { formatNumber } from '@rerun/i18n/format'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'

import { formatWorked, humanWorkdays, percentChange } from '@/lib/rewind/format'
import { TrendingDown, TrendingUpIcon } from '@/lib/icons'
import { RewindCount } from '../RewindCount'
import { RewindHeadline, RewindReveal, RewindSlideFrame } from '../RewindSlideFrame'
import type { RewindSlideProps } from './types'

export function HoursSlide({ payload }: RewindSlideProps) {
    const locale = useLocale()
    const t = useTranslations('rewind.hours')
    const worked = formatWorked(payload.totals.workedMs)
    const workdays = humanWorkdays(payload.totals.workedMs)
    const change = payload.previous ? percentChange(payload.totals.workedMs, payload.previous.workedMs) : null

    return (
        <RewindSlideFrame tone="blue" eyebrow={t('eyebrow')} centered className="rewind-wide:items-center rewind-wide:text-center">
            <RewindHeadline>{t('headline')}</RewindHeadline>
            <RewindReveal delay={0.4} className="my-4 flex items-baseline gap-3 rewind-wide:my-2 rewind-wide:justify-center">
                <RewindCount value={worked.value} delay={0.6} className="text-[min(7rem,24cqh)] leading-none font-semibold tracking-tighter rewind-wide:text-[min(10rem,24cqh)]" />
                <span className="text-3xl font-medium text-white/80 rewind-wide:text-5xl">{t(`units.${worked.unit}`)}</span>
            </RewindReveal>
            {workdays >= 0.5 && (
                <RewindReveal delay={1.6} className="text-lg text-balance text-white/80 rewind-wide:max-w-xl rewind-wide:text-xl">
                    {t.rich('workdays', { days: workdays, b: chunks => <span className="font-semibold text-white">{chunks}</span> })}
                </RewindReveal>
            )}
            {change !== null && change !== 0 && (
                <RewindReveal delay={2.2} className="mt-6">
                    <Badge tone={change > 0 ? 'green' : 'orange'} size="lg" leading={change > 0 ? <TrendingUpIcon className="size-4" /> : <TrendingDown className="size-4" />}>
                        {t('vsLastWeek', { change: formatNumber(change / 100, locale, { style: 'percent', signDisplay: 'exceptZero' }) })}
                    </Badge>
                </RewindReveal>
            )}
        </RewindSlideFrame>
    )
}
