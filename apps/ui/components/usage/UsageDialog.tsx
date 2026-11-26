'use client'

import { CHART_PALETTE } from '@rerun/ui/monitoring'
import { EmptyState, ScrollFade, Skeleton } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'

import { readWorkspaceUsageAction } from '@/app/api/_actions/usage.actions'
import type { UsageCoworker, UsagePerson } from '@/app/api/_services/usage.service'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { PanelDialogContent } from '@/components/dialogs/PanelDialogContent'
import { Dialog } from '@/components/ui/dialog'
import type { FilterOption } from '@/components/ui/filter-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { downloadBlob } from '@/lib/files/download-blob'
import { BarChart3Icon, ServerIcon } from '@/lib/icons'

import { UsageChart, type ChartPoint } from './UsageChart'
import { LiveDot, UsageDirectoryProvider, useUsageFormat, useUsageLabels, type UsageLabels } from './usage-directory'
import { FilterBar, periodOf, useUsageFilters, type FilterOptions } from './UsageFilters'
import { CoverageNote, KpiRow, RankedList, RunsTable, Section } from './UsageParts'
import {
    DAY,
    autoGranularity,
    bucketStarts,
    bucketize,
    granularitiesFor,
    groupKeyOf,
    groupRows,
    inPeriod,
    loadWindow,
    matches,
    previousPeriod,
    reachesNow,
    spendOf,
    toUsageRow,
    tokensOf,
    totalsOf,
    usageCsv,
    type Dimension,
    type Granularity,
    type GroupBy,
    type Period,
    type UsageRow,
} from './usage-model'

const POLL_MS = 15_000
// The engine and the browser do not share a clock: a refresh reads a little before the last one.
const SINCE_MARGIN_MS = 60_000
const HISTORY_DAYS = 365

type Loaded = { rows: Map<string, UsageRow>; coworkers: UsageCoworker[]; people: UsagePerson[]; truncated: boolean }
type UsageState = { status: 'loading' } | { status: 'error'; reason: 'noEngine' | 'unreachable' | 'outdated' } | ({ status: 'ready' } & Loaded)

// Reads the window once, then only what changed since the last read, every few seconds while the
// dialog is on screen. `to` null reads up to now.
function useWorkspaceUsage(span: { from: number; to: number | null }) {
    const [state, setState] = useState<UsageState>({ status: 'loading' })
    const [now, setNow] = useState(() => Date.now())
    const lastRead = useRef<{ from: number; to: number | null; at: number } | null>(null)

    const read = useCallback(async () => {
        const at = Date.now()
        const previous = lastRead.current?.from === span.from && lastRead.current.to === span.to ? lastRead.current : null
        if (!previous) setState(prev => (prev.status === 'error' ? prev : { status: 'loading' }))
        const result = await readWorkspaceUsageAction({ from: new Date(span.from).toISOString(), to: new Date(span.to ?? at).toISOString(), since: previous ? new Date(previous.at - SINCE_MARGIN_MS).toISOString() : undefined })
        setNow(at)
        if (!result.ok) {
            if (!previous) setState({ status: 'error', reason: result.reason })
            return
        }
        lastRead.current = { from: span.from, to: span.to, at }
        setState(prev => {
            const rows = new Map(previous && prev.status === 'ready' ? prev.rows : [])
            for (const run of result.usage.runs) rows.set(run.id, toUsageRow(run))
            return { status: 'ready', rows, coworkers: result.usage.coworkers, people: result.usage.people, truncated: result.usage.truncated || (prev.status === 'ready' && prev.truncated && previous !== null) }
        })
    }, [span.from, span.to])

    useVisibleInterval(read, POLL_MS)
    return { state, now }
}

const MAX_SERIES = 5
const OTHER = 'other'

function ChartSection({ rows, previousRows, period, now, labels }: { rows: UsageRow[]; previousRows: UsageRow[]; period: Period; now: number; labels: UsageLabels }) {
    const t = useTranslations('usage.chart')
    const format = useUsageFormat()
    const [metric, setMetric] = useState<'cost' | 'tokens'>('cost')
    const [groupBy, setGroupBy] = useState<GroupBy>('model')
    const [picked, setPicked] = useState<Granularity | null>(null)
    const offered = granularitiesFor(period)
    const granularity = picked && offered.includes(picked) ? picked : autoGranularity(period)

    const points = useMemo((): ChartPoint[] => {
        const measure = metric === 'cost' ? spendOf : tokensOf
        // Under spend, a model Rerun cannot price adds nothing to the bars: it never shows as $0.
        const ranked = groupRows(rows, groupBy).filter(group => (metric === 'cost' ? group.cost > 0 : group.input + group.output > 0))
        const series = new Map(ranked.slice(0, MAX_SERIES).map((group, i) => [group.key, CHART_PALETTE[i]]))
        const seriesOf = (row: UsageRow) => {
            const groupKey = groupKeyOf(row, groupBy)
            return series.has(groupKey) ? groupKey : OTHER
        }
        const labelOf = (seriesKey: string) => {
            if (seriesKey === OTHER) return t('other')
            if (groupBy === 'coworker') return labels.coworkerName(seriesKey)
            if (groupBy === 'model') return labels.modelName(seriesKey)
            return labels.starter(seriesKey).label
        }
        const starts = bucketStarts(period, granularity)
        const current = bucketize(rows, starts, granularity, seriesOf, measure)
        const before = previousPeriod(period)
        const earlier = bucketize(previousRows, bucketStarts(before, granularity), granularity, () => '', measure)
        return current.map((bucket, i) => {
            const top = [...bucket.bySeries].sort((a, b) => b[1] - a[1])[0]
            return {
                label: format.bucket(bucket.start, granularity),
                total: bucket.total,
                previous: earlier[i]?.total ?? 0,
                top: top && top[1] > 0 ? { label: labelOf(top[0]), color: series.get(top[0]) ?? 'var(--muted-foreground)', value: top[1] } : null,
            }
        })
    }, [rows, previousRows, period, granularity, metric, groupBy, labels, format, t])

    return (
        <Section
            title={
                <Tabs value={metric} onValueChange={value => setMetric(value as 'cost' | 'tokens')}>
                    <TabsList>
                        <TabsTrigger value="cost">{t('spend')}</TabsTrigger>
                        <TabsTrigger value="tokens">{t('tokens')}</TabsTrigger>
                    </TabsList>
                </Tabs>
            }
            actions={
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={groupBy} onValueChange={value => setGroupBy(value as GroupBy)}>
                        <SelectTrigger size="sm" className="w-36">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(['coworker', 'starter', 'model'] as const).map(group => (
                                <SelectItem key={group} value={group}>
                                    {t(`by.${group}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={granularity} onValueChange={value => setPicked(value as Granularity)}>
                        <SelectTrigger size="sm" className="w-28">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {offered.map(g => (
                                <SelectItem key={g} value={g}>
                                    {t(`granularity.${g}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            }
        >
            <UsageChart key={`${groupBy}-${metric}`} points={points} format={metric === 'cost' ? format.usd : format.tokens} metric={metric} partialLast={period.to >= now - POLL_MS * 2} step={granularity} />
        </Section>
    )
}

function UsageBody({ rows, now, api, period, truncated }: { rows: UsageRow[]; now: number; api: ReturnType<typeof useUsageFilters>; period: Period; truncated: boolean }) {
    const t = useTranslations('usage')
    const format = useUsageFormat()
    const labels = useUsageLabels()
    const values = api.filters.values

    const { current, previous, all } = useMemo(() => {
        const before = previousPeriod(period)
        const live = reachesNow(period, now)
        const inside = rows.filter(row => inPeriod(row, period) || (live && row.running))
        return { all: inside, current: inside.filter(row => matches(row, values)), previous: rows.filter(row => inPeriod(row, before) && !row.running && matches(row, values)) }
    }, [rows, period, values, now])
    const totals = useMemo(() => totalsOf(current), [current])
    const previousTotals = useMemo(() => totalsOf(previous), [previous])

    const options = useMemo((): FilterOptions => {
        const keysOf = (dimension: Dimension, keyOf: (row: UsageRow) => string) => [...new Set([...all.map(keyOf), ...values[dimension]])]
        const option = (value: string, labelled: { label: string; leadingSmall: ReactNode }): FilterOption => ({ value, label: labelled.label, icon: labelled.leadingSmall })
        return {
            coworkers: [...new Set([...labels.coworkerIds, ...values.coworkers])].map(id => option(id, labels.coworker(id))),
            starters: keysOf('starters', row => row.starterKey).map(key => option(key, labels.starter(key, all.find(row => row.starterKey === key)))),
            models: keysOf('models', row => row.modelKey).map(key => option(key, labels.model(key, all.find(row => row.modelKey === key)?.provider))),
            pricing: [
                { value: 'priced', label: t('pricing.priced') },
                { value: 'unpriced', label: t('pricing.unpriced') },
            ],
        }
    }, [all, values, labels, t])

    const onExport = () => {
        const csv = usageCsv(current, { coworker: row => labels.coworkerName(row.coworkerId), starter: row => labels.starter(row.starterKey, row, true).label, model: row => labels.modelName(row.modelKey) })
        downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `usage-${new Date(now).toISOString().slice(0, 10)}.csv`)
    }

    const ranking = (by: GroupBy, dimension: Dimension, title: string) => (
        <Section title={title}>
            <RankedList
                groups={groupRows(current, by)}
                labelOf={key => (by === 'coworker' ? labels.coworker(key) : by === 'model' ? labels.model(key, current.find(row => row.modelKey === key)?.provider) : labels.starter(key, current.find(row => row.starterKey === key)))}
                metric="cost"
                onPick={key => api.toggle(dimension, key)}
                picked={values[dimension]}
                format={format}
            />
        </Section>
    )

    return (
        <div className="flex flex-col gap-5 p-4">
            <FilterBar api={api} period={period} now={now} earliest={now - HISTORY_DAYS * DAY} options={options} shown={current.length} total={all.length} format={format} onExport={onExport} />
            <KpiRow totals={totals} previous={previousTotals} format={format} />
            <ChartSection rows={current} previousRows={previous} period={period} now={now} labels={labels} />
            <div className="grid gap-5 md:grid-cols-3">
                {ranking('coworker', 'coworkers', t('rankings.coworker'))}
                {ranking('starter', 'starters', t('rankings.starter'))}
                {ranking('model', 'models', t('rankings.model'))}
            </div>
            <CoverageNote totals={totals} />
            {truncated && <p className="text-xs text-muted-foreground">{t('truncated')}</p>}
            <RunsTable rows={current} now={now} labels={labels} format={format} />
        </div>
    )
}

// The same frame as the dialog, while the first read is on its way.
function UsageSkeleton() {
    return (
        <div className="flex flex-col gap-5 p-4">
            <div className="flex flex-wrap gap-2">
                {[32, 28, 28, 24, 20].map((width, i) => (
                    <Skeleton key={i} className="h-9 rounded-lg" style={{ width: `${width * 4}px` }} />
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-[5.5rem] rounded-xl" />
                ))}
            </div>
            <Skeleton className="h-8 w-40 rounded-lg" />
            <Skeleton className="h-[22rem] rounded-xl" />
            <div className="grid gap-5 md:grid-cols-3">
                {[0, 1, 2].map(i => (
                    <Skeleton key={i} className="h-40 rounded-xl" />
                ))}
            </div>
        </div>
    )
}

function UsageContent() {
    const t = useTranslations('usage')
    const api = useUsageFilters('30d')
    const [opened] = useState(() => Date.now())
    const { from, to } = loadWindow(api.filters.preset, api.filters.custom, opened)
    const span = useMemo(() => ({ from, to }), [from, to])
    const { state, now } = useWorkspaceUsage(span)
    const rows = useMemo(() => (state.status === 'ready' ? [...state.rows.values()] : []), [state])

    return (
        <>
            <DialogHeaderBar icon={BarChart3Icon} title={t('title')} description={t('description')} actions={state.status === 'ready' ? <LiveDot label={t('live')} /> : undefined} />
            {state.status === 'error' ? (
                <EmptyState icon={ServerIcon} title={t(`error.${state.reason}.title`)} description={t(`error.${state.reason}.description`)} />
            ) : (
                <ScrollFade className="min-h-0 flex-1">
                    {state.status === 'loading' ? (
                        <UsageSkeleton />
                    ) : (
                        <UsageDirectoryProvider coworkers={state.coworkers} people={state.people}>
                            <UsageBody rows={rows} now={now} api={api} period={periodOf(api.filters, now)} truncated={state.truncated} />
                        </UsageDirectoryProvider>
                    )}
                </ScrollFade>
            )}
        </>
    )
}

export function UsageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <PanelDialogContent showCloseButton className="sm:h-[min(56rem,94dvh)] sm:max-w-[min(64rem,96vw)]">
                <UsageContent />
            </PanelDialogContent>
        </Dialog>
    )
}
