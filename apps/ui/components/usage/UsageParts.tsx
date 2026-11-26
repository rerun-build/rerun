'use client'

import { useTranslations } from 'next-intl'
import { useMemo, useState, type ReactNode } from 'react'

import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Progress } from '@/components/ui/progress'
import { AlertTriangleIcon, ArrowDownIcon, ArrowUpIcon, SearchIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { CostValue, LiveDot, type Labelled, type UsageFormat, type UsageLabels } from './usage-directory'
import { isUnpriced, sortRows, type Group, type SortKey, type Totals, type UsageRow } from './usage-model'

export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn('min-w-0', className)}>
            <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{title}</h3>
                {actions}
            </div>
            {children}
        </section>
    )
}

function Delta({ now, before }: { now: number; before: number }) {
    const t = useTranslations('usage.kpi')
    if (before === 0) return null
    const change = (now - before) / before
    if (Math.abs(change) < 0.005) return <span className="text-muted-foreground">{t('same')}</span>
    const up = change > 0
    const Arrow = up ? ArrowUpIcon : ArrowDownIcon
    return (
        <span className={cn('inline-flex items-center gap-0.5 tabular-nums', up ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400')}>
            <Arrow className="size-3" />
            {t.rich('vsPrevious', { percent: Math.round(Math.abs(change * 100)), muted: chunks => <span className="ms-1 text-muted-foreground">{chunks}</span> })}
        </span>
    )
}

function Kpi({ label, value, detail, tone }: { label: string; value: ReactNode; detail: ReactNode; tone?: 'warn' }) {
    return (
        <div className={cn('min-w-0 rounded-xl bg-card p-3 ring-1 ring-border', tone === 'warn' && 'ring-amber-500/30')}>
            <p className="truncate text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums">{value}</p>
            <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
        </div>
    )
}

// Spend and tokens are the chart's own headers: the row keeps what the chart does not say.
export function KpiRow({ totals, previous, format }: { totals: Totals; previous: Totals; format: UsageFormat }) {
    const t = useTranslations('usage.kpi')
    return (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi label={t('runs')} value={format.count(totals.runs)} detail={<Delta now={totals.runs} before={previous.runs} />} />
            <Kpi label={t('tokens')} value={t('inOut', { input: format.tokens(totals.input), output: format.tokens(totals.output) })} detail={t('tokensDetail')} />
            <Kpi label={t('notPriced')} value={format.count(totals.unpriced)} detail={t('notPricedDetail')} tone={totals.unpriced > 0 ? 'warn' : undefined} />
            <Kpi label={t('notRecorded')} value={format.count(totals.unattributed)} detail={t('notRecordedDetail')} tone={totals.unattributed > 0 ? 'warn' : undefined} />
        </div>
    )
}

const share = (value: number, max: number) => (max > 0 ? (value / max) * 100 : 0)

export function RankedList({ groups, labelOf, metric, onPick, picked, format }: { groups: Group[]; labelOf: (key: string) => Labelled; metric: 'cost' | 'tokens'; onPick: (key: string) => void; picked: string[]; format: UsageFormat }) {
    const t = useTranslations('usage')
    const valueOf = (group: Group) => (metric === 'cost' ? group.cost : group.input + group.output)
    const max = Math.max(...groups.map(valueOf), 0)
    if (groups.length === 0) return <p className="px-1.5 py-2 text-sm text-muted-foreground">{t('empty.short')}</p>
    return (
        <ul className="flex flex-col gap-0.5">
            {groups.map(group => {
                const row = labelOf(group.key)
                return (
                    <li key={group.key}>
                        <button type="button" onClick={() => onPick(group.key)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-start transition-colors hover:bg-muted/60', picked.includes(group.key) && 'bg-brand/10')}>
                            {row.leading}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2 text-sm">
                                    <span className="truncate">{row.label}</span>
                                    {metric === 'cost' && !group.priced ? group.unpriced > 0 ? <CostValue micros={null} /> : <span className="shrink-0 text-muted-foreground">-</span> : <span className="shrink-0 tabular-nums">{metric === 'cost' ? format.usd(group.cost) : format.tokens(group.input + group.output)}</span>}
                                </div>
                                <div className="mt-1.5 flex items-center gap-2">
                                    <Progress value={share(valueOf(group), max)} size="sm" />
                                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{t('runsCount', { count: group.runs, countText: format.count(group.runs) })}</span>
                                </div>
                            </div>
                        </button>
                    </li>
                )
            })}
        </ul>
    )
}

export function CoverageNote({ totals }: { totals: Totals }) {
    const t = useTranslations('usage.coverage')
    if (totals.unpriced === 0 && totals.unattributed === 0) return null
    return (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
                {totals.unpriced > 0 && t('unpriced', { count: totals.unpriced })} {totals.unattributed > 0 && t('unattributed', { count: totals.unattributed })}
            </span>
        </p>
    )
}

// A run with no cost: still running, failed before its end, or on a model Rerun cannot price.
function RunCost({ row, className }: { row: UsageRow; className?: string }) {
    if (row.costMicros !== null || isUnpriced(row)) return <CostValue micros={row.costMicros} className={className} />
    return <span className={cn('text-muted-foreground', className)}>-</span>
}

function SortHead({ label, sortKey, sort, onSort, end }: { label: string; sortKey: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (key: SortKey) => void; end?: boolean }) {
    const active = sort.key === sortKey
    const Arrow = sort.desc ? ArrowDownIcon : ArrowUpIcon
    return (
        <button type="button" onClick={() => onSort(sortKey)} className={cn('flex items-center gap-0.5 hover:text-foreground', end && 'justify-end', active && 'text-foreground')}>
            {label}
            {active && <Arrow className="size-3" />}
        </button>
    )
}

const PAGE = 15
const GRID = 'grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_4rem_4rem_5rem]'

export function RunsTable({ rows, now, labels, format }: { rows: UsageRow[]; now: number; labels: UsageLabels; format: UsageFormat }) {
    const t = useTranslations('usage.runs')
    const [query, setQuery] = useState('')
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'when', desc: true })
    const [shown, setShown] = useState(PAGE)
    const matching = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const filtered = needle ? rows.filter(row => [labels.coworkerName(row.coworkerId), labels.modelName(row.modelKey), labels.starter(row.starterKey, row, true).label].some(text => text.toLowerCase().includes(needle))) : rows
        return sortRows(filtered, sort.key, sort.desc)
    }, [rows, query, sort, labels])
    const onSort = (key: SortKey) => setSort(prev => ({ key, desc: prev.key === key ? !prev.desc : true }))
    const when = (row: UsageRow) => (row.running ? <LiveDot label={t('running')} /> : format.ago(row.startedAt, now))

    return (
        <Section
            title={
                <span>
                    {t('title')} <span className="font-normal text-muted-foreground tabular-nums">{format.count(matching.length)}</span>
                </span>
            }
            actions={
                <InputGroup className="h-8 w-full sm:w-56">
                    <InputGroupAddon>
                        <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput value={query} onChange={event => setQuery(event.target.value)} placeholder={t('search')} />
                </InputGroup>
            }
        >
            <div className="min-w-0 overflow-hidden rounded-xl ring-1 ring-border">
                <div className={cn('hidden gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid', GRID)}>
                    <SortHead label={t('when')} sortKey="when" sort={sort} onSort={onSort} />
                    <span>{t('coworker')}</span>
                    <span>{t('startedBy')}</span>
                    <span>{t('model')}</span>
                    <SortHead label={t('input')} sortKey="input" sort={sort} onSort={onSort} end />
                    <SortHead label={t('output')} sortKey="output" sort={sort} onSort={onSort} end />
                    <SortHead label={t('cost')} sortKey="cost" sort={sort} onSort={onSort} end />
                </div>
                <ul className="divide-y">
                    {matching.slice(0, shown).map(row => {
                        const starter = labels.starter(row.starterKey, row, true)
                        const starterCell = (
                            <span className={cn('flex min-w-0 items-center gap-1.5', row.starterKind !== 'person' && 'text-muted-foreground')}>
                                {starter.leadingSmall}
                                <span className="truncate">{starter.label}</span>
                            </span>
                        )
                        const model = labels.model(row.modelKey, row.provider)
                        return (
                            <li key={row.id} className={cn('px-3 py-2 text-sm', row.running && 'bg-green-500/5')}>
                                <div className={cn('hidden items-center gap-3 md:grid', GRID)}>
                                    <span className="text-xs text-muted-foreground tabular-nums">{when(row)}</span>
                                    <span className="flex min-w-0 items-center gap-2">
                                        {labels.coworkerFace(row.coworkerId, 22)}
                                        <span className="truncate">{labels.coworkerName(row.coworkerId)}</span>
                                    </span>
                                    {starterCell}
                                    <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                                        {model.leadingSmall}
                                        <span className="truncate">{model.label}</span>
                                    </span>
                                    <span className="text-end text-xs tabular-nums">{format.tokens(row.inputTokens)}</span>
                                    <span className="text-end text-xs tabular-nums">{format.tokens(row.outputTokens)}</span>
                                    <RunCost row={row} className="justify-self-end text-xs" />
                                </div>
                                <div className="flex items-start gap-2.5 md:hidden">
                                    {labels.coworkerFace(row.coworkerId, 28)}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate font-medium">{labels.coworkerName(row.coworkerId)}</span>
                                            <RunCost row={row} className="shrink-0 text-xs" />
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                            {starterCell}
                                            <span className="shrink-0">·</span>
                                            <span className="shrink-0 tabular-nums">{t('inOut', { input: format.tokens(row.inputTokens), output: format.tokens(row.outputTokens) })}</span>
                                        </div>
                                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                {model.leadingSmall}
                                                <span className="truncate">{model.label}</span>
                                            </span>
                                            <span className="shrink-0">{when(row)}</span>
                                        </div>
                                    </div>
                                </div>
                            </li>
                        )
                    })}
                    {matching.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">{t('none')}</li>}
                </ul>
                {matching.length > shown && (
                    <button type="button" onClick={() => setShown(count => count + PAGE)} className="w-full border-t px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                        {t('more', { count: Math.min(PAGE, matching.length - shown) })}
                    </button>
                )}
            </div>
        </Section>
    )
}
