'use client'

import { formatDate, formatNumber } from '@rerun/i18n/format'
import { useCallback, useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import type { EngineUsageBucket } from '@rerun/contracts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../primitives/chart'
import { CHART_FALLBACK_COLOR, CHART_PALETTE, chartColorAt } from './chart-palette'
import { cn } from '../cn'
import { useKitTranslations, useUiLocale } from '../locale'

const compact = (n: number, locale: string) => formatNumber(n, locale, { notation: 'compact', maximumFractionDigits: 1 })

function formatCost(n: number): string {
    return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`
}

function dayShort(day: string, locale: string): string {
    const d = new Date(`${day}T00:00:00`)
    return Number.isNaN(d.getTime()) ? day : formatDate(d, locale, { month: 'short', day: 'numeric' })
}

type Series = { key: string; label: string; color: string }

export type TokenUsageChartProps = {
    metric?: 'tokens' | 'cost'
    breakdown?: 'total' | 'inputOutput' | 'model'
    chartType?: 'area' | 'bar' | 'donut' | 'stat'
    buckets: EngineUsageBucket[] | null
    className?: string
    // Recharts draws itself over ~1.5s in JS, which no CSS lever stops: a screenshot taken while the
    // area is still growing shows a half-drawn chart. Off for anything captured by rerun-shot.
    animated?: boolean
}

export function TokenUsageChart({ metric = 'tokens', breakdown = 'total', chartType = 'area', buckets, className, animated = true }: TokenUsageChartProps) {
    const locale = useUiLocale()
    const t = useKitTranslations()
    const formatValue = useCallback((n: number) => (metric === 'cost' ? formatCost(n) : compact(n, locale)), [metric, locale])

    const daily = useMemo(() => {
        const map = new Map<string, { day: string; tokens: number; cost: number; input: number; output: number; cached: number; runCount: number }>()
        for (const b of buckets ?? []) {
            const d = map.get(b.day) ?? { day: b.day, tokens: 0, cost: 0, input: 0, output: 0, cached: 0, runCount: 0 }
            d.tokens += b.totalTokens
            d.cost += b.costMicros / 1_000_000
            d.input += b.inputTokens
            d.output += b.outputTokens
            d.cached += b.cachedInputTokens
            d.runCount += b.runCount
            map.set(b.day, d)
        }
        return [...map.values()].sort((a, b) => a.day.localeCompare(b.day))
    }, [buckets])

    const effectiveBreakdown = breakdown === 'inputOutput' && metric === 'cost' ? 'total' : breakdown

    const models = useMemo(() => {
        const totals = new Map<string, number>()
        for (const b of buckets ?? []) {
            const name = b.model ?? 'unknown'
            const value = metric === 'cost' ? b.costMicros / 1_000_000 : b.totalTokens
            totals.set(name, (totals.get(name) ?? 0) + value)
        }
        return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({ name, value, key: `model_${i}`, color: chartColorAt(i) }))
    }, [buckets, metric])

    const { rows, series } = useMemo(() => {
        if (effectiveBreakdown === 'model') {
            const perDay = new Map<string, Map<string, number>>()
            for (const b of buckets ?? []) {
                const name = b.model ?? 'unknown'
                const value = metric === 'cost' ? b.costMicros / 1_000_000 : b.totalTokens
                const inner = perDay.get(b.day) ?? new Map<string, number>()
                inner.set(name, (inner.get(name) ?? 0) + value)
                perDay.set(b.day, inner)
            }
            const s: Series[] = models.map(m => ({ key: m.key, label: m.name, color: m.color }))
            const r = daily.map(d => {
                const row: Record<string, number | string> = { day: dayShort(d.day, locale) }
                for (const m of models) row[m.key] = perDay.get(d.day)?.get(m.name) ?? 0
                return row
            })
            return { rows: r, series: s }
        }
        if (effectiveBreakdown === 'inputOutput') {
            const s: Series[] = [
                { key: 'input', label: t('monitoring.usage.input'), color: CHART_PALETTE[0] },
                { key: 'output', label: t('monitoring.usage.output'), color: CHART_PALETTE[1] },
                { key: 'cached', label: t('monitoring.usage.cached'), color: CHART_PALETTE[2] },
            ]
            const r = daily.map(d => ({ day: dayShort(d.day, locale), input: d.input, output: d.output, cached: d.cached }))
            return { rows: r, series: s }
        }
        const s: Series[] = [{ key: 'value', label: metric === 'cost' ? t('monitoring.usage.cost') : t('monitoring.usage.tokens'), color: CHART_PALETTE[0] }]
        const r = daily.map(d => ({ day: dayShort(d.day, locale), value: metric === 'cost' ? d.cost : d.tokens }))
        return { rows: r, series: s }
    }, [buckets, daily, models, metric, effectiveBreakdown, locale, t])

    const chartConfig = useMemo<ChartConfig>(() => Object.fromEntries(series.map(s => [s.key, { label: s.label, color: s.color }])), [series])

    const donutData = useMemo(() => {
        if (effectiveBreakdown === 'inputOutput') {
            const input = daily.reduce((sum, d) => sum + d.input, 0)
            const output = daily.reduce((sum, d) => sum + d.output, 0)
            const cached = daily.reduce((sum, d) => sum + d.cached, 0)
            return [
                { name: t('monitoring.usage.input'), value: input, fill: CHART_PALETTE[0] },
                { name: t('monitoring.usage.output'), value: output, fill: CHART_PALETTE[1] },
                { name: t('monitoring.usage.cached'), value: cached, fill: CHART_PALETTE[2] },
            ].filter(s => s.value > 0)
        }
        return models.map(m => ({ name: m.name, value: m.value, fill: m.color })).filter(s => s.value > 0)
    }, [daily, models, effectiveBreakdown, t])

    const stat = useMemo(() => {
        const total = daily.reduce((sum, d) => sum + (metric === 'cost' ? d.cost : d.tokens), 0)
        const runCount = daily.reduce((sum, d) => sum + d.runCount, 0)
        const sparkRows = daily.map(d => ({ v: metric === 'cost' ? d.cost : d.tokens }))
        let delta: number | null = null
        if (daily.length >= 2) {
            const mid = Math.floor(daily.length / 2)
            const first = sparkRows.slice(0, mid).reduce((s, r) => s + r.v, 0)
            const second = sparkRows.slice(mid).reduce((s, r) => s + r.v, 0)
            if (first > 0) delta = ((second - first) / first) * 100
        }
        return { total, runCount, sparkRows, delta }
    }, [daily, metric])

    const isEmpty = daily.length === 0

    return (
        <div className={cn('h-full w-full p-1', className)}>
            {isEmpty ? (
                <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">{buckets === null ? t('monitoring.chart.loading') : t('monitoring.usage.noUsage')}</div>
            ) : chartType === 'stat' ? (
                <div className="flex h-full flex-col justify-center gap-1 px-2">
                    <div className="text-3xl font-semibold leading-none text-foreground">{formatValue(stat.total)}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{metric === 'cost' ? t('monitoring.usage.totalCost') : t('monitoring.usage.totalTokens')}</span>
                        <span>·</span>
                        <span>{t('monitoring.usage.runs', { count: stat.runCount })}</span>
                        {stat.delta !== null && <span className={stat.delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}>{stat.delta >= 0 ? '▲' : '▼'} {Math.abs(stat.delta).toFixed(0)}%</span>}
                    </div>
                    <ChartContainer config={{ v: { label: metric === 'cost' ? t('monitoring.usage.cost') : t('monitoring.usage.tokens'), color: CHART_PALETTE[0] } }} className="mt-2 h-16 w-full aspect-auto">
                        <AreaChart data={stat.sparkRows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                            <Area dataKey="v" type="monotone" stroke="var(--color-v)" fill="var(--color-v)" fillOpacity={0.15} strokeWidth={1.5} dot={false} isAnimationActive={animated} />
                        </AreaChart>
                    </ChartContainer>
                </div>
            ) : chartType === 'donut' ? (
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                    <PieChart>
                        <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                        <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={2} strokeWidth={1} isAnimationActive={animated}>
                            {donutData.map((d, i) => (
                                <Cell key={i} fill={d.fill} />
                            ))}
                        </Pie>
                    </PieChart>
                </ChartContainer>
            ) : chartType === 'bar' ? (
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                    <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} minTickGap={16} />
                        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={formatValue} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        {series.map(s => (
                            <Bar key={s.key} dataKey={s.key} stackId="a" fill={`var(--color-${s.key})`} radius={series.length === 1 ? [3, 3, 0, 0] : 0} isAnimationActive={animated} />
                        ))}
                    </BarChart>
                </ChartContainer>
            ) : (
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                    <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} minTickGap={16} />
                        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={formatValue} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        {series.map(s => (
                            <Area key={s.key} dataKey={s.key} type="monotone" stackId="a" stroke={`var(--color-${s.key})`} fill={`var(--color-${s.key})`} fillOpacity={0.2} strokeWidth={1.5} isAnimationActive={animated} />
                        ))}
                    </AreaChart>
                </ChartContainer>
            )}
        </div>
    )
}
