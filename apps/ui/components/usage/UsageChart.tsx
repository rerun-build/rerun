'use client'

import { ChartContainer, type ChartConfig } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bar, BarChart, XAxis, YAxis } from 'recharts'

import { cn } from '@/lib/utils'

// One bar: its total, the same slot of the previous period, and the series that weighs most in it.
export type ChartPoint = { label: string; total: number; previous: number; top: { label: string; color: string; value: number } | null }

function Header({ label, value, sub, active }: { label: string; value: string; sub?: string; active?: boolean }) {
    return (
        <div className="min-w-0 px-3 py-3 @xl:px-4">
            <p className={cn('truncate text-xs font-medium transition-colors', active ? 'text-foreground' : 'text-muted-foreground/70')}>{label}</p>
            <p className={cn('mt-1 truncate text-base font-medium tracking-tight tabular-nums @md:text-xl @2xl:text-2xl', active ? 'text-foreground' : 'text-muted-foreground/60')}>
                {value}
                {sub && <span className="ms-1.5 text-sm font-normal text-muted-foreground @max-xl:hidden">{sub}</span>}
            </p>
        </div>
    )
}

const PILL_TOP = 8
const PLOT_TOP = 56
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

type ShapeProps = { x?: number; y?: number; width?: number; height?: number; index?: number }

// The house chart grammar of the Rerun visuals (skill `rerun-image-chart`): bars hatched at 45° in
// the brand, dense at the top and fading out at the bottom, one active bar as a solid gradient, a
// pill of values over it; no grid, no axis line. Hovering moves the active bar: the solid fill fades
// in over the hatching, the column behind lights up, and the pill glides above it on a hairline.
export function UsageChart({ points, format, partialLast, metric, step, height = 224 }: { points: ChartPoint[]; format: (n: number) => string; partialLast?: boolean; metric: 'cost' | 'tokens'; step: 'hour' | 'day' | 'week'; height?: number }) {
    const t = useTranslations('usage.chart')
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const [hover, setHover] = useState<number | null>(null)
    const plotRef = useRef<HTMLDivElement>(null)
    const pillRef = useRef<HTMLDivElement>(null)
    const [plotWidth, setPlotWidth] = useState(0)
    const [pillWidth, setPillWidth] = useState(0)
    const lastIndex = points.length - 1

    const stats = useMemo(() => {
        const total = points.reduce((sum, point) => sum + point.total, 0)
        const before = points.reduce((sum, point) => sum + point.previous, 0)
        const busiest = points.reduce((best, point, i) => (point.total > points[best].total ? i : best), 0)
        return { total, before, average: points.length ? total / points.length : 0, busiest }
    }, [points])

    const active = hover !== null && hover <= lastIndex ? hover : stats.busiest
    const activePoint = points[active]
    const delta = stats.before > 0 ? (stats.total - stats.before) / stats.before : null
    const domainMax = Math.max(...points.map(point => point.total), 0) * 1.08 || 1
    const config: ChartConfig = { total: { label: t(`total.${metric}`) } }

    useLayoutEffect(() => {
        const plot = plotRef.current
        if (!plot) return
        const observer = new ResizeObserver(() => setPlotWidth(plot.clientWidth))
        observer.observe(plot)
        setPlotWidth(plot.clientWidth)
        return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => setPillWidth(pillRef.current?.offsetWidth ?? 0), [active, activePoint?.total, activePoint?.top?.label])

    const band = points.length ? plotWidth / points.length : 0
    const center = (active + 0.5) * band
    const pillLeft = Math.max(0, Math.min(plotWidth - pillWidth, center - pillWidth / 2))
    const barTop = PLOT_TOP + height - ((activePoint?.total ?? 0) / domainMax) * height
    const stemTop = PILL_TOP + 34

    const shape = ({ x = 0, y = 0, width = 0, height: barHeight = 0, index = 0 }: ShapeProps) => {
        if (barHeight <= 0) return <g />
        const isActive = index === active
        const today = partialLast && index === lastIndex
        const radius = Math.min(4, width / 3)
        const fade = { transition: `opacity 220ms ${EASE}` }
        return (
            <g>
                <rect x={x} y={y} width={width} height={barHeight} rx={radius} fill={`url(#hatch-${uid})`} mask={`url(#fade-${uid})`} style={{ ...fade, opacity: isActive ? 0 : today ? 0.55 : 1 }} />
                <rect x={x} y={y} width={width} height={barHeight} rx={radius} fill={`url(#solid-${uid})`} style={{ ...fade, opacity: isActive ? 1 : 0 }} />
            </g>
        )
    }

    const column = ({ x = 0, y = 0, width = 0, height: columnHeight = 0, index = 0 }: ShapeProps) => {
        const pad = Math.min(6, width * 0.35)
        return <rect x={x - pad} y={y} width={width + pad * 2} height={columnHeight} rx={8} fill="var(--color-brand)" style={{ transition: `opacity 220ms ${EASE}`, opacity: hover === index ? 0.07 : 0 }} />
    }

    const activeLabel = !activePoint ? '' : hover === null ? t('busiest', { label: activePoint.label }) : partialLast && active === lastIndex ? t('soFar', { label: activePoint.label }) : activePoint.label
    const top = activePoint?.top

    const pillParts: ReactNode[] = [
        <span key="v" className="font-semibold text-foreground tabular-nums">
            {format(activePoint?.total ?? 0)}
        </span>,
        <span key="p" className="text-muted-foreground">
            {t.rich('before', { value: () => <span className="font-semibold text-foreground tabular-nums">{format(activePoint?.previous ?? 0)}</span> })}
        </span>,
    ]
    if (top && activePoint && activePoint.total > 0)
        pillParts.push(
            <span key="t" className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full" style={{ background: top.color }} />
                {top.label} <span className="font-semibold text-foreground tabular-nums">{t('share', { percent: Math.round((top.value / activePoint.total) * 100) })}</span>
            </span>
        )

    return (
        <div className="@container min-w-0 overflow-hidden rounded-xl bg-card ring-1 ring-border">
            <div className="grid grid-cols-3 divide-x divide-border border-b rtl:divide-x-reverse">
                <Header label={t(`total.${metric}`)} value={format(stats.total)} sub={delta === null ? undefined : t('delta', { percent: Math.round(delta * 100) })} />
                <Header label={t(`average.${step}`)} value={format(stats.average)} />
                <Header label={activeLabel} value={format(activePoint?.total ?? 0)} active />
            </div>
            <div className="relative px-3" style={{ paddingTop: PLOT_TOP }}>
                <div ref={plotRef} className="absolute inset-x-3 top-0 h-0" />
                <div
                    ref={pillRef}
                    className="pointer-events-none absolute z-10 flex items-center rounded-full border bg-popover py-1 text-xs shadow-[0_8px_30px_-8px_rgb(0_0_0/0.3)]"
                    style={{ top: PILL_TOP, left: 12 + pillLeft, transition: `left 260ms ${EASE}`, opacity: plotWidth ? 1 : 0 }}
                >
                    {pillParts.map((part, i) => (
                        <span key={i} className={cn('flex items-center px-2.5 whitespace-nowrap', i > 0 && 'border-s border-border')}>
                            {part}
                        </span>
                    ))}
                </div>
                <div
                    aria-hidden
                    className="pointer-events-none absolute w-px bg-gradient-to-b from-border to-transparent"
                    style={{ left: 12 + center, top: stemTop, height: Math.max(0, barTop - stemTop - 4), transition: `left 260ms ${EASE}, height 260ms ${EASE}`, opacity: plotWidth ? 1 : 0 }}
                />
                <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
                    <BarChart data={points} margin={{ left: 0, right: 0, top: 0, bottom: 0 }} barCategoryGap="24%" onMouseMove={state => setHover(state.activeTooltipIndex == null ? null : Number(state.activeTooltipIndex))} onMouseLeave={() => setHover(null)}>
                        <defs>
                            <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                <rect width="6" height="6" fill="color-mix(in oklab, var(--color-brand) 10%, transparent)" />
                                <rect width="2.5" height="6" fill="var(--color-brand)" />
                            </pattern>
                            <linearGradient id={`fade-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="white" stopOpacity={1} />
                                <stop offset="100%" stopColor="white" stopOpacity={0.08} />
                            </linearGradient>
                            <mask id={`fade-${uid}`} maskContentUnits="objectBoundingBox">
                                <rect width="1" height="1" fill={`url(#fade-grad-${uid})`} />
                            </mask>
                            <linearGradient id={`solid-${uid}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="color-mix(in oklab, var(--color-brand) 78%, white)" />
                                <stop offset="100%" stopColor="color-mix(in oklab, var(--color-brand) 85%, black)" />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="label" hide />
                        <YAxis hide domain={[0, domainMax]} />
                        <Bar dataKey="total" shape={shape} background={column} isAnimationActive={false} />
                    </BarChart>
                </ChartContainer>
            </div>
            <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-[11px] whitespace-nowrap text-muted-foreground">
                <span>{points[0]?.label ?? ''}</span>
                <span>{points[lastIndex]?.label ?? ''}</span>
            </div>
        </div>
    )
}
