'use client'

import { formatDate, formatNumber } from '@rerun/i18n/format'
import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { STATS_METRIC_META } from '@rerun/contracts'
import type { StatsChartType, StatsDataset, StatsGroupBy, StatsMetric, StatsPoint } from '@rerun/contracts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../primitives/chart'
import { CHART_FALLBACK_COLOR, CHART_PALETTE, chartColorAt } from './chart-palette'
import { cn } from '../cn'
import { useKitTranslations, useUiLocale } from '../locale'

const MAX_SERIES = 8

const compact = (n: number, locale: string) => formatNumber(n, locale, { notation: 'compact', maximumFractionDigits: 1 })

function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return `${minutes}m ${seconds}s`
}

function makeFormatter(metric: StatsMetric, locale: string): (n: number) => string {
    const unit = STATS_METRIC_META[metric].unit
    if (unit === 'costMicros') {
        return n => {
            const dollars = n / 1_000_000
            return `$${dollars >= 1 ? dollars.toFixed(2) : dollars.toFixed(4)}`
        }
    }
    if (unit === 'ms') return formatDuration
    if (unit === 'ratio') return n => `${(n * 100).toFixed(1)}%`
    return n => compact(n, locale)
}

function bucketLabel(bucket: string, locale: string): string {
    if (bucket.includes('T')) {
        const d = new Date(`${bucket}:00Z`)
        return Number.isNaN(d.getTime()) ? bucket : formatDate(d, locale, { hour: 'numeric' })
    }
    const d = new Date(`${bucket}T00:00:00`)
    return Number.isNaN(d.getTime()) ? bucket : formatDate(d, locale, { month: 'short', day: 'numeric' })
}

type Series = { key: string; label: string; color: string }

function combine(agg: 'sum' | 'avg', entries: { value: number; count: number }[]): number {
    if (agg === 'sum') return entries.reduce((s, e) => s + e.value, 0)
    const totalCount = entries.reduce((s, e) => s + e.count, 0)
    if (totalCount === 0) return 0
    return entries.reduce((s, e) => s + e.value * e.count, 0) / totalCount
}

export type StatsChartProps = {
    dataset: StatsDataset
    metric: StatsMetric
    groupBy?: StatsGroupBy
    chartType?: StatsChartType
    points: StatsPoint[] | null
    className?: string
}

export function StatsChart({ dataset, metric, groupBy = 'none', chartType = 'area', points, className }: StatsChartProps) {
    const locale = useUiLocale()
    const t = useKitTranslations()
    const otherLabel = t('monitoring.chart.other')
    const metricLabel = t(`monitoring.metrics.${metric}`)
    const agg = STATS_METRIC_META[metric].agg
    const formatValue = useMemo(() => makeFormatter(metric, locale), [metric, locale])

    const groups = useMemo(() => {
        const totals = new Map<string, { weight: number; entries: { value: number; count: number }[] }>()
        for (const p of points ?? []) {
            const name = p.group ?? 'unknown'
            const g = totals.get(name) ?? { weight: 0, entries: [] }
            g.weight += agg === 'avg' ? p.value * p.count : p.value
            g.entries.push({ value: p.value, count: p.count })
            totals.set(name, g)
        }
        const ranked = [...totals.entries()].sort((a, b) => b[1].weight - a[1].weight)
        const kept = ranked.slice(0, MAX_SERIES).map(([name], i) => ({ name, key: `g_${i}`, color: chartColorAt(i) }))
        const folded = new Set(ranked.slice(MAX_SERIES).map(([name]) => name))
        return { kept, folded }
    }, [points, agg])

    const hasOther = groups.folded.size > 0

    const { rows, series } = useMemo(() => {
        const buckets = [...new Set((points ?? []).map(p => p.bucket))].sort()
        if (groupBy === 'none') {
            const s: Series[] = [{ key: 'value', label: metricLabel, color: CHART_PALETTE[0] }]
            const r = buckets.map(b => {
                const entries = (points ?? []).filter(p => p.bucket === b)
                return { bucket: bucketLabel(b, locale), value: combine(agg, entries) }
            })
            return { rows: r, series: s }
        }
        const s: Series[] = groups.kept.map(g => ({ key: g.key, label: g.name, color: g.color }))
        if (hasOther) s.push({ key: 'g_other', label: otherLabel, color: CHART_FALLBACK_COLOR })
        const r = buckets.map(b => {
            const inBucket = (points ?? []).filter(p => p.bucket === b)
            const row: Record<string, number | string> = { bucket: bucketLabel(b, locale) }
            for (const g of groups.kept) {
                row[g.key] = combine(agg, inBucket.filter(p => (p.group ?? 'unknown') === g.name))
            }
            if (hasOther) row['g_other'] = combine(agg, inBucket.filter(p => groups.folded.has(p.group ?? 'unknown')))
            return row
        })
        return { rows: r, series: s }
    }, [points, groups, hasOther, groupBy, agg, locale, otherLabel, metricLabel])

    const chartConfig = useMemo<ChartConfig>(() => Object.fromEntries(series.map(s => [s.key, { label: s.label, color: s.color }])), [series])

    const donutData = useMemo(() => {
        const perGroup = new Map<string, { value: number; count: number }[]>()
        for (const p of points ?? []) {
            const name = groups.folded.has(p.group ?? 'unknown') ? otherLabel : p.group ?? 'unknown'
            const list = perGroup.get(name) ?? []
            list.push({ value: p.value, count: p.count })
            perGroup.set(name, list)
        }
        const colorByName = new Map(groups.kept.map(g => [g.name, g.color]))
        return [...perGroup.entries()]
            .map(([name, entries]) => ({ name, value: combine(agg, entries), fill: colorByName.get(name) ?? CHART_FALLBACK_COLOR }))
            .filter(d => d.value > 0)
            .sort((a, b) => b.value - a.value)
    }, [points, groups, agg, otherLabel])

    const stat = useMemo(() => {
        const all = (points ?? []).map(p => ({ value: p.value, count: p.count }))
        const total = combine(agg, all)
        const rowCount = all.reduce((s, e) => s + e.count, 0)
        const buckets = [...new Set((points ?? []).map(p => p.bucket))].sort()
        const sparkRows = buckets.map(b => ({ v: combine(agg, (points ?? []).filter(p => p.bucket === b)) }))
        let delta: number | null = null
        if (sparkRows.length >= 2) {
            const mid = Math.floor(sparkRows.length / 2)
            const first = combine(agg, sparkRows.slice(0, mid).map(r => ({ value: r.v, count: 1 })))
            const second = combine(agg, sparkRows.slice(mid).map(r => ({ value: r.v, count: 1 })))
            if (first > 0) delta = ((second - first) / first) * 100
        }
        return { total, rowCount, sparkRows, delta }
    }, [points, agg])

    const isEmpty = (points ?? []).length === 0
    const effectiveChart = chartType === 'donut' && groupBy === 'none' ? 'stat' : chartType

    return (
        <div className={cn('h-full w-full p-1', className)}>
            {isEmpty ? (
                <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">{points === null ? t('monitoring.chart.loading') : t('monitoring.chart.noData')}</div>
            ) : effectiveChart === 'stat' ? (
                <div className="flex h-full flex-col justify-center gap-1 px-2">
                    <div className="text-3xl font-semibold leading-none text-foreground">{formatValue(stat.total)}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{metricLabel}</span>
                        <span>·</span>
                        <span>{t(`monitoring.chart.rowCount.${dataset}`, { count: compact(stat.rowCount, locale) })}</span>
                        {stat.delta !== null && <span className={stat.delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}>{stat.delta >= 0 ? '▲' : '▼'} {Math.abs(stat.delta).toFixed(0)}%</span>}
                    </div>
                    <ChartContainer config={{ v: { label: metricLabel, color: CHART_PALETTE[0] } }} className="mt-2 h-16 w-full aspect-auto">
                        <AreaChart data={stat.sparkRows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                            <Area dataKey="v" type="monotone" stroke="var(--color-v)" fill="var(--color-v)" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                        </AreaChart>
                    </ChartContainer>
                </div>
            ) : effectiveChart === 'donut' ? (
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                    <PieChart>
                        <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                        <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={2} strokeWidth={1}>
                            {donutData.map((d, i) => (
                                <Cell key={i} fill={d.fill} />
                            ))}
                        </Pie>
                    </PieChart>
                </ChartContainer>
            ) : effectiveChart === 'bar' ? (
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                    <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={6} minTickGap={16} />
                        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatValue} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        {series.map(s => (
                            <Bar key={s.key} dataKey={s.key} stackId={agg === 'sum' ? 'a' : undefined} fill={`var(--color-${s.key})`} radius={series.length === 1 ? [3, 3, 0, 0] : 0} />
                        ))}
                    </BarChart>
                </ChartContainer>
            ) : effectiveChart === 'line' ? (
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                    <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={6} minTickGap={16} />
                        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatValue} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        {series.map(s => (
                            <Line key={s.key} dataKey={s.key} type="monotone" stroke={`var(--color-${s.key})`} strokeWidth={1.5} dot={false} />
                        ))}
                    </LineChart>
                </ChartContainer>
            ) : (
                <ChartContainer config={chartConfig} className="h-full w-full aspect-auto">
                    <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={6} minTickGap={16} />
                        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatValue} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        {series.map(s => (
                            <Area key={s.key} dataKey={s.key} type="monotone" stackId={agg === 'sum' ? 'a' : undefined} stroke={`var(--color-${s.key})`} fill={`var(--color-${s.key})`} fillOpacity={0.2} strokeWidth={1.5} />
                        ))}
                    </AreaChart>
                </ChartContainer>
            )}
        </div>
    )
}
