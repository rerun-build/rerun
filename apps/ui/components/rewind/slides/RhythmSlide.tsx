'use client'

import { formatDate } from '@rerun/i18n/format'
import { motion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'

import { Gauge } from '@/components/ui/gauge'
import { dailyTotals } from '@/lib/rewind/format'
import { cn } from '@/lib/utils'
import { RewindCount } from '../RewindCount'
import { RewindHeadline, RewindReveal, RewindSlideFrame } from '../RewindSlideFrame'
import { useLocalHourly } from '../useLocalHourly'
import { useSettledValue } from '../useSettledValue'
import type { RewindSlideProps } from './types'

// 2024-01-01 is a Monday, the first day of the week the totals start on.
const fullDayName = (day: number, locale: string) => formatDate(Date.UTC(2024, 0, 1 + day), locale, { weekday: 'long', timeZone: 'UTC' })

function SuccessRing({ ratio }: { ratio: number }) {
    const shown = useSettledValue(ratio, 1.8)
    return (
        <div className="relative size-20 shrink-0">
            <Gauge ratio={shown} strokeWidth={1.8} className="size-full text-lime-300 [--gauge-duration:1400ms]" />
            <RewindCount value={Math.round(ratio * 100)} delay={1.8} suffix="%" className="absolute inset-0 flex items-center justify-center text-lg font-semibold" />
        </div>
    )
}

export function RhythmSlide({ payload }: RewindSlideProps) {
    const locale = useLocale()
    const t = useTranslations('rewind.rhythm')
    const days = dailyTotals(useLocalHourly(payload.hourly, payload.weekStart), locale)
    const peak = Math.max(1, ...days.map(day => day.runs))
    const busiest = days.find(day => day.runs === peak) ?? days[0]
    const successRatio = payload.totals.runs ? payload.totals.done / payload.totals.runs : 0

    return (
        <RewindSlideFrame
            tone="magenta"
            eyebrow={t('eyebrow')}
            visual={
                <>
                    <div className="flex h-[38cqh] items-end gap-2 rewind-wide:h-auto rewind-wide:min-h-0 rewind-wide:flex-1">
                        {days.map((day, i) => {
                            const isPeak = day === busiest
                            return (
                                <div key={day.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                                    <motion.span className="text-xs font-medium text-white/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 + i * 0.08 }}>
                                        {day.runs}
                                    </motion.span>
                                    <motion.div
                                        className={cn('w-full origin-bottom rounded-t-lg', isPeak ? 'bg-white' : 'bg-white/35')}
                                        style={{ height: `${Math.max(4, (day.runs / peak) * 100)}%` }}
                                        initial={{ scaleY: 0 }}
                                        animate={{ scaleY: 1 }}
                                        transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.6 + i * 0.08 }}
                                    />
                                    <span className={cn('text-xs', isPeak ? 'font-semibold text-white' : 'text-white/60')}>{day.label}</span>
                                </div>
                            )
                        })}
                    </div>

                    <RewindReveal delay={1.6} className="mt-6 flex items-center gap-4 rounded-2xl bg-black/25 p-4 backdrop-blur-sm">
                        <SuccessRing ratio={successRatio} />
                        <p className="text-sm text-white/80">
                            <span className="block text-base font-semibold text-white">{t('finished', { count: payload.totals.done })}</span>
                            {payload.totals.errors > 0 ? t('errors', { count: payload.totals.errors }) : t('noErrors')}
                        </p>
                    </RewindReveal>
                </>
            }
        >
            <RewindHeadline>
                {t.rich('headline', { count: payload.totals.runs, day: fullDayName(days.indexOf(busiest), locale), value: () => <RewindCount value={payload.totals.runs} delay={0.3} />, br: () => <br /> })}
            </RewindHeadline>
        </RewindSlideFrame>
    )
}
