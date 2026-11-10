'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { dayLabel, periodDayCount, type CreditBalance, type CreditUsage } from '@/ee/lib/billing/credit-usage'
import { shortDate } from '@/ee/lib/billing/dates'
import { formatCredits } from '@/ee/lib/billing/plans'
import { cn } from '@/lib/utils'

import { KIND_FILL, Swatch } from './parts'

export type ChartMode = 'daily' | 'cumulative'

const HEIGHT = 112

type Day = CreditUsage['days'][number]

const spentOn = (day: Day) => day.aiMicros + day.dataMicros

// One bar per day of the period, AI under paid data, the days ahead left as faint slots so the
// period's shape is readable at a glance.
function Daily({ days, slots, hover, onHover }: { days: Day[]; slots: number; hover: number | null; onHover: (index: number | null) => void }) {
    const max = Math.max(...days.map(spentOn), 1)
    return (
        <div className="flex items-end gap-[2px]" style={{ height: HEIGHT }} onMouseLeave={() => onHover(null)}>
            {Array.from({ length: slots }, (_, index) => {
                const day = days[index]
                return (
                    <div key={index} className="flex h-full flex-1 flex-col justify-end" onMouseEnter={() => onHover(day ? index : null)}>
                        {day && spentOn(day) > 0 ? (
                            <div className={cn('flex flex-col gap-px transition-opacity', hover != null && hover !== index && 'opacity-40')} style={{ height: `${(spentOn(day) / max) * 100}%` }}>
                                {day.dataMicros > 0 && <div className={cn('rounded-t-[2px]', KIND_FILL.data)} style={{ flexGrow: day.dataMicros }} />}
                                {day.aiMicros > 0 && <div className={cn(day.dataMicros === 0 && 'rounded-t-[2px]', KIND_FILL.ai)} style={{ flexGrow: day.aiMicros }} />}
                            </div>
                        ) : (
                            <div className="h-1 rounded-[2px] bg-muted-foreground/15" />
                        )}
                    </div>
                )
            })}
        </div>
    )
}

// Spent so far against the credit, and where today's pace lands by the end of the period.
function Cumulative({ days, slots, balance, trial, hover, onHover, locale }: { days: Day[]; slots: number; balance: CreditBalance; trial: boolean; hover: number | null; onHover: (index: number | null) => void; locale: string }) {
    const month = balance.wholeMicros - balance.topupLeftMicros
    const whole = balance.wholeMicros
    const points = days.reduce<number[]>((sums, day) => [...sums, (sums.at(-1) ?? 0) + spentOn(day)], [])
    const running = points.at(-1) ?? 0
    const projected = running + (running / Math.max(days.length, 1)) * (slots - days.length)
    const top = Math.max(whole, projected, 1) * 1.05
    const x = (index: number) => ((index + 0.5) / slots) * 100
    const y = (micros: number) => HEIGHT - (micros / top) * HEIGHT
    const line = points.map((micros, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(micros)}`).join(' ')
    const area = `${line} L${x(points.length - 1)},${HEIGHT} L${x(0)},${HEIGHT} Z`
    const showMonth = !trial && month > 0 && month < whole
    const t = useTranslations('billing')
    const figure = formatCredits(whole, locale)

    return (
        <div className="relative" style={{ height: HEIGHT }} onMouseLeave={() => onHover(null)}>
            <svg viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                {showMonth && <line x1="0" x2="100" y1={y(month)} y2={y(month)} className="stroke-muted-foreground/50" strokeDasharray="2 2" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
                <line x1="0" x2="100" y1={y(whole)} y2={y(whole)} className={showMonth ? 'stroke-muted-foreground/25' : 'stroke-muted-foreground/50'} strokeDasharray="2 2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {points.length > 0 && <path d={area} className="fill-[#4d34f7]/15 dark:fill-[#7a66ff]/20" />}
                {points.length > 0 && <path d={line} fill="none" className="stroke-[#4d34f7] dark:stroke-[#7a66ff]" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                {points.length > 0 && <path d={`M${x(points.length - 1)},${y(running)} L${x(slots - 1)},${y(projected)}`} fill="none" className="stroke-[#4d34f7]/60 dark:stroke-[#7a66ff]/60" strokeDasharray="3 3" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={HEIGHT} className="stroke-foreground/30" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
            </svg>
            {showMonth && (
                <span className="absolute left-0 -translate-y-full pb-0.5 text-[10px] text-muted-foreground" style={{ top: y(month) }}>
                    {t('usage.chart.monthly', { figure: formatCredits(month, locale) })}
                </span>
            )}
            <span className={cn('absolute -translate-y-full pb-0.5 text-[10px]', showMonth ? 'right-0 text-muted-foreground/70' : 'left-0 text-muted-foreground')} style={{ top: y(whole) }}>
                {trial ? t('usage.chart.trialCredits', { figure }) : showMonth ? t('usage.chart.topup', { figure }) : t('usage.chart.credits', { figure })}
            </span>
            <div className="absolute inset-0 flex">
                {Array.from({ length: slots }, (_, index) => (
                    <div key={index} className="h-full flex-1" onMouseEnter={() => onHover(index < days.length ? index : null)} />
                ))}
            </div>
        </div>
    )
}

function value(chunks: ReactNode) {
    return <span className="text-foreground tabular-nums">{chunks}</span>
}

export function UsageChart({ usage, balance, trial, mode }: { usage: CreditUsage; balance: CreditBalance; trial: boolean; mode: ChartMode }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const [hover, setHover] = useState<number | null>(null)
    const slots = periodDayCount(usage)
    const day = hover != null ? usage.days[hover] : null
    const upTo = hover != null ? usage.days.slice(0, hover + 1).reduce((sum, entry) => sum + spentOn(entry), 0) : 0

    return (
        <figure className="flex flex-col gap-2">
            <div className="flex h-9 items-end justify-between gap-3 text-xs">
                {day ? (
                    <>
                        <span className="font-medium">{dayLabel(day.day, locale)}</span>
                        <span className="flex items-center gap-3 text-muted-foreground">
                            {mode === 'cumulative' ? (
                                <span>{t.rich('usage.chart.spentSoFar', { figure: formatCredits(upTo, locale), value })}</span>
                            ) : (
                                <>
                                    <span className="flex items-center gap-1.5">
                                        <Swatch kind="ai" />
                                        {t.rich('usage.chart.ai', { figure: formatCredits(day.aiMicros, locale), value })}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <Swatch kind="data" />
                                        {t.rich('usage.chart.data', { figure: formatCredits(day.dataMicros, locale), value })}
                                    </span>
                                </>
                            )}
                        </span>
                    </>
                ) : (
                    <span className="text-muted-foreground">{mode === 'daily' ? t('usage.chart.perDay') : t('usage.chart.paceCaption')}</span>
                )}
            </div>
            {mode === 'daily' ? <Daily days={usage.days} slots={slots} hover={hover} onHover={setHover} /> : <Cumulative days={usage.days} slots={slots} balance={balance} trial={trial} hover={hover} onHover={setHover} locale={locale} />}
            <div className="relative flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>{shortDate(usage.period.start, locale)}</span>
                {usage.days.length < slots && (
                    <span className="absolute -translate-x-1/2 text-foreground" style={{ left: `${((usage.days.length - 0.5) / slots) * 100}%` }}>
                        {t('usage.chart.today')}
                    </span>
                )}
                <span>{trial ? t('usage.chart.trialEnds', { date: shortDate(usage.period.end, locale) }) : t('usage.chart.resets', { date: shortDate(usage.period.end, locale) })}</span>
            </div>
        </figure>
    )
}
