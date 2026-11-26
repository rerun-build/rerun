import type { RunStarterKind } from '@rerun/contracts'
import { startOfDay } from '@rerun/ui/foreman'
import type { WorkspaceUsageRun } from '@/app/api/_services/usage.service'
import { isSubscriptionProvider } from '@/lib/engine/subscription-providers'

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

// One run as the dashboard counts it. `costMicros` null with `done` is a model Rerun cannot price:
// its tokens count, its cost is left out, never shown as $0.
export type UsageRow = {
    id: string
    coworkerId: string
    startedAt: number
    running: boolean
    status: WorkspaceUsageRun['status']
    model: string
    modelKey: string
    provider: string | null
    inputTokens: number
    outputTokens: number
    costMicros: number | null
    starterKey: string
    starterKind: RunStarterKind | null
    starterId: string | null
    starterName: string | null
}

export const NOT_RECORDED = 'unknown'
export const UNKNOWN_MODEL = 'unknown'

const SUBSCRIPTION_SUFFIX = '::subscription'

// The same model on a subscription and on an API key are two rows: only one of them has a price.
export function modelKeyOf(model: string, provider: string | null): string {
    return isSubscriptionProvider(provider) ? `${model}${SUBSCRIPTION_SUFFIX}` : model
}

export function splitModelKey(key: string): { model: string; subscription: boolean } {
    return key.endsWith(SUBSCRIPTION_SUFFIX) ? { model: key.slice(0, -SUBSCRIPTION_SUFFIX.length), subscription: true } : { model: key, subscription: false }
}

// A person is one row of "Started by"; the coworkers that call one another, the schedules, the
// webhooks... are each one row, whoever they are: no person is charged for them.
export function starterKeyOf(kind: RunStarterKind | null, id: string | null): string {
    if (kind === null) return NOT_RECORDED
    if (kind === 'person') return `person:${id ?? ''}`
    return kind
}

export function toUsageRow(run: WorkspaceUsageRun): UsageRow {
    return {
        id: run.id,
        coworkerId: run.coworkerId,
        startedAt: Date.parse(run.startedAt),
        running: run.status === 'running',
        status: run.status,
        model: run.model ?? UNKNOWN_MODEL,
        modelKey: modelKeyOf(run.model ?? UNKNOWN_MODEL, run.provider),
        provider: run.provider,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        costMicros: run.costMicros,
        starterKey: starterKeyOf(run.starterKind, run.starterId),
        starterKind: run.starterKind,
        starterId: run.starterId,
        starterName: run.starterName,
    }
}

const UPPERCASE_WORDS = new Set(['gpt', 'glm'])

// A model the catalog does not name, read from its id: "anthropic/claude-sonnet-4-5" reads
// "Claude Sonnet 4.5", "openai/gpt-5.1-mini" reads "GPT-5.1 Mini".
export function readableModelId(id: string): string {
    const bare = id.slice(id.lastIndexOf('/') + 1).replace(/(\d)-(\d)(?!\d)/g, '$1.$2')
    const words = bare.split('-').filter(Boolean).map(word => (UPPERCASE_WORDS.has(word.toLowerCase()) || /^\d+b$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    return words.join(' ').replace(/^(GPT|GLM) (?=\d)/, '$1-')
}

export const isUnpriced = (row: UsageRow) => row.status === 'done' && row.costMicros === null
export const spendOf = (row: UsageRow) => row.costMicros ?? 0
export const tokensOf = (row: UsageRow) => row.inputTokens + row.outputTokens

export type Totals = { runs: number; input: number; output: number; cost: number; unpriced: number; unattributed: number; running: number }

export const EMPTY_TOTALS: Totals = { runs: 0, input: 0, output: 0, cost: 0, unpriced: 0, unattributed: 0, running: 0 }

export function totalsOf(rows: UsageRow[]): Totals {
    return rows.reduce<Totals>(
        (t, row) => ({
            runs: t.runs + 1,
            input: t.input + row.inputTokens,
            output: t.output + row.outputTokens,
            cost: t.cost + spendOf(row),
            unpriced: t.unpriced + (isUnpriced(row) ? 1 : 0),
            unattributed: t.unattributed + (row.starterKey === NOT_RECORDED ? 1 : 0),
            running: t.running + (row.running ? 1 : 0),
        }),
        EMPTY_TOTALS
    )
}

export type GroupBy = 'coworker' | 'starter' | 'model'

export function groupKeyOf(row: UsageRow, by: GroupBy): string {
    if (by === 'coworker') return row.coworkerId
    if (by === 'model') return row.modelKey
    return row.starterKey
}

// A group is priced once one of its runs has a price: runs still going, or on a model Rerun cannot
// price, never make up a $0.
export type Group = Totals & { key: string; priced: boolean }

export function groupRows(rows: UsageRow[], by: GroupBy): Group[] {
    const buckets = new Map<string, UsageRow[]>()
    for (const row of rows) {
        const key = groupKeyOf(row, by)
        const bucket = buckets.get(key)
        if (bucket) bucket.push(row)
        else buckets.set(key, [row])
    }
    return [...buckets]
        .map(([key, grouped]) => {
            const totals = totalsOf(grouped)
            return { key, ...totals, priced: grouped.some(row => row.costMicros !== null) }
        })
        .sort((a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output))
}

// --- Periods, in the local time of the person reading ---

export const PERIOD_PRESETS = ['today', '7d', '30d', '90d', 'mtd'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

const PRESET_DAYS: Record<Exclude<PeriodPreset, 'today' | 'mtd'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

export type Period = { preset: PeriodPreset | null; from: number; to: number }

export function presetPeriod(preset: PeriodPreset, now: number): Period {
    if (preset === 'today') return { preset, from: startOfDay(now), to: now }
    if (preset === 'mtd') {
        const d = new Date(now)
        return { preset, from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now }
    }
    return { preset, from: now - PRESET_DAYS[preset] * DAY, to: now }
}

// A range picked on the calendar covers its first and last days whole. One that ends today is cut
// at now when it is read (`periodOf`), so a run that starts later still falls inside it.
export function rangePeriod(from: Date, to: Date): Period {
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime() - 1
    return { preset: null, from: new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime(), to: end }
}

// Only a period that goes on until now shows the runs still going.
export const reachesNow = (period: Period, now: number) => period.to >= now

export function previousPeriod(period: Period): Period {
    const length = period.to - period.from
    return { preset: null, from: period.from - length, to: period.from }
}

export const inPeriod = (row: UsageRow, period: Period) => row.startedAt >= period.from && row.startedAt <= period.to

// What the dialog reads: the period and the one before it, for as long as it stays open. `to` null
// reads up to now. Today and Month to date grow with the clock, and so does the period before them:
// they read a day, or a month, earlier.
export function loadWindow(preset: PeriodPreset | null, custom: Period | null, at: number): { from: number; to: number | null } {
    if (!preset && custom) return { from: previousPeriod(custom).from, to: custom.to }
    const period = presetPeriod(preset ?? '30d', at)
    if (preset === 'today') return { from: period.from - DAY, to: null }
    if (preset === 'mtd') return { from: period.from - 31 * DAY, to: null }
    return { from: previousPeriod(period).from, to: null }
}

// --- Filters ---

export type Pricing = 'priced' | 'unpriced'
export type Dimension = 'coworkers' | 'starters' | 'models' | 'pricing'
export type FilterValues = Record<Dimension, string[]>

export const EMPTY_FILTER_VALUES: FilterValues = { coworkers: [], starters: [], models: [], pricing: [] }

function pricingOf(row: UsageRow): Pricing | null {
    if (row.costMicros !== null) return 'priced'
    return isUnpriced(row) ? 'unpriced' : null
}

export function valueOf(row: UsageRow, dimension: Dimension): string | null {
    if (dimension === 'coworkers') return row.coworkerId
    if (dimension === 'starters') return row.starterKey
    if (dimension === 'models') return row.modelKey
    return pricingOf(row)
}

export function matches(row: UsageRow, values: FilterValues): boolean {
    return (Object.keys(values) as Dimension[]).every(dimension => {
        const picked = values[dimension]
        if (picked.length === 0) return true
        const value = valueOf(row, dimension)
        return value !== null && picked.includes(value)
    })
}

// --- Chart buckets ---

export type Granularity = 'hour' | 'day' | 'week'

export const GRANULARITIES: Granularity[] = ['hour', 'day', 'week']

// Past these lengths a bar is too thin to read: Hourly stops at two weeks, Daily at a year.
const GRANULARITY_MAX_DAYS: Record<Granularity, number> = { hour: 14, day: 366, week: Infinity }

export function granularitiesFor(period: Period): Granularity[] {
    const days = (period.to - period.from) / DAY
    return GRANULARITIES.filter(granularity => days <= GRANULARITY_MAX_DAYS[granularity])
}

export function autoGranularity(period: Period): Granularity {
    const length = period.to - period.from
    if (length <= 2 * DAY) return 'hour'
    if (length <= 45 * DAY) return 'day'
    return 'week'
}

function nextStart(at: number, granularity: Granularity): number {
    if (granularity === 'hour') return at + HOUR
    const d = new Date(at)
    d.setDate(d.getDate() + (granularity === 'day' ? 1 : 7))
    return d.getTime()
}

// Bars sit on whole local hours or local days, so the last one is "today" (or "this hour"), not a
// window that slides with the clock.
export function bucketStarts(period: Period, granularity: Granularity): number[] {
    const first = granularity === 'hour' ? new Date(period.from).setMinutes(0, 0, 0) : startOfDay(period.from)
    const starts: number[] = []
    for (let at = first; at <= period.to; at = nextStart(at, granularity)) starts.push(at)
    return starts.length ? starts : [first]
}

export type Bucket = { start: number; total: number; bySeries: Map<string, number> }

export function bucketize(rows: UsageRow[], starts: number[], granularity: Granularity, seriesOf: (row: UsageRow) => string, measure: (row: UsageRow) => number): Bucket[] {
    const buckets: Bucket[] = starts.map(start => ({ start, total: 0, bySeries: new Map() }))
    const end = nextStart(starts[starts.length - 1], granularity)
    for (const row of rows) {
        if (row.startedAt < starts[0] || row.startedAt >= end) continue
        let index = starts.length - 1
        while (index > 0 && starts[index] > row.startedAt) index--
        const value = measure(row)
        const bucket = buckets[index]
        bucket.total += value
        const series = seriesOf(row)
        bucket.bySeries.set(series, (bucket.bySeries.get(series) ?? 0) + value)
    }
    return buckets
}

// --- Runs list and export ---

export type SortKey = 'when' | 'input' | 'output' | 'cost'

const SORT_VALUE: Record<SortKey, (row: UsageRow) => number> = {
    when: row => row.startedAt,
    input: row => row.inputTokens,
    output: row => row.outputTokens,
    cost: row => row.costMicros ?? -1,
}

export function sortRows(rows: UsageRow[], key: SortKey, desc: boolean): UsageRow[] {
    const value = SORT_VALUE[key]
    return [...rows].sort((a, b) => (desc ? value(b) - value(a) : value(a) - value(b)))
}

// A cell a spreadsheet would run as a formula (a name starting with "=", "+", "-", "@") is read as text.
function csvCell(value: string | number | null): string {
    if (value === null) return ''
    const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export type CsvLabels = { coworker: (row: UsageRow) => string; starter: (row: UsageRow) => string; model: (row: UsageRow) => string }

// Cost is empty, never 0, for a run Rerun could not price.
export function usageCsv(rows: UsageRow[], labels: CsvLabels): string {
    const header = ['started_at', 'status', 'coworker', 'started_by', 'model', 'provider', 'input_tokens', 'output_tokens', 'cost_usd']
    const lines = rows.map(row =>
        [new Date(row.startedAt).toISOString(), row.status, labels.coworker(row), labels.starter(row), labels.model(row), row.provider, row.inputTokens, row.outputTokens, row.costMicros === null ? null : (row.costMicros / 1_000_000).toFixed(6)].map(csvCell).join(',')
    )
    return [header.join(','), ...lines].join('\n')
}
