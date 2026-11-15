import type { FactorySnapshot } from '@rerun/contracts'

export type MetricKey =
    | 'queued' | 'building' | 'review' | 'checks' | 'shipped'
    | 'runs' | 'totalTokens' | 'cachedShare' | 'avgDuration' | 'errorRate'
    | 'planWeek' | 'signIn'

export type MetricGroup = 'jobs' | 'runs' | 'plan'

export type MetricDef = { key: MetricKey; group: MetricGroup; label: string; definition: string; source: string }

export const METRICS: MetricDef[] = [
    { key: 'queued', group: 'jobs', label: 'Queued', definition: 'Issues the delegator has taken and not yet sent to a builder.', source: 'ledger: jobs waiting or queued' },
    { key: 'building', group: 'jobs', label: 'Building', definition: 'Builds and fixes running now, every copy counted.', source: 'ledger: jobs building or fixing' },
    { key: 'review', group: 'jobs', label: 'Review', definition: 'Reviews running now.', source: 'ledger: jobs reviewing' },
    { key: 'checks', group: 'jobs', label: 'Checks', definition: 'Approved pull requests waiting for their workflow runs.', source: 'ledger: jobs in checks' },
    { key: 'shipped', group: 'jobs', label: 'Shipped', definition: 'Pull requests merged into dev today.', source: 'ledger: merges since 00:00 UTC' },
    { key: 'runs', group: 'runs', label: 'Runs', definition: 'Runs started today by the factory coworkers.', source: 'started today, from the ledger runs of the snapshot' },
    { key: 'totalTokens', group: 'runs', label: 'Tokens', definition: 'Total tokens of the runs started today.', source: 'started today, from the ledger runs of the snapshot' },
    { key: 'cachedShare', group: 'runs', label: 'Cached', definition: 'Share of input tokens read from the cache.', source: 'stats: cachedInputTokens / inputTokens, 24h' },
    { key: 'avgDuration', group: 'runs', label: 'Avg run', definition: 'Average duration of a run.', source: 'stats: runs, avgDurationMs, 24h' },
    { key: 'errorRate', group: 'runs', label: 'Errors', definition: 'Share of runs that ended in error.', source: 'stats: runs, errorRate, 24h' },
    { key: 'planWeek', group: 'plan', label: 'Plan week', definition: 'Share of the Claude plan weekly window used.', source: 'connection plan limits (PlanLimitsBlock)' },
    { key: 'signIn', group: 'plan', label: 'Sign-in', definition: 'Minutes until the Claude sign-in expires; near the end the delegator holds sending.', source: 'connection sign-in expiry' },
]

export type MetricValues = Record<MetricKey, { text: string; fill?: number; warn?: boolean; title?: string }>

type BarCounts = { queued: number; building: number; review: number; checks: number; merged: number; runs: number }

const NO_DATA = { text: '—', title: 'no data yet' }

function tokenText(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`
    return String(n)
}

function sameLocalDay(a: number, b: number): boolean {
    const x = new Date(a)
    const y = new Date(b)
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export function barModel(input: { snapshot: FactorySnapshot | null; counts: BarCounts; held: boolean; now: number; start: number }): { sample: boolean; values: MetricValues } {
    const { snapshot, counts, held, now, start } = input
    if (!snapshot) {
        const signInMin = Math.max(0, 412 - Math.floor((now - start) / 60_000))
        const runs = 118 + counts.runs
        return {
            sample: true,
            values: {
                queued: { text: String(counts.queued) },
                building: { text: String(counts.building) },
                review: { text: String(counts.review) },
                checks: { text: String(counts.checks) },
                shipped: { text: String(counts.merged) },
                runs: { text: String(runs) },
                totalTokens: { text: `${(runs * 0.31).toFixed(1)}M` },
                cachedShare: { text: '87%', fill: 87 },
                avgDuration: { text: '2m 41s' },
                errorRate: { text: '1.7%' },
                planWeek: { text: '56%', fill: 56 },
                signIn: held ? { text: 'renewing', fill: 2, warn: true } : { text: `${signInMin} min`, fill: Math.min(100, (signInMin / 480) * 100) },
            },
        }
    }
    const inStates = (...states: string[]) => String(snapshot.jobs.filter(j => states.includes(j.state)).length)
    let runCount = 0
    let tokens = 0
    let known = 0
    let anyRuns = false
    for (const job of snapshot.jobs) {
        if (!job.runs) continue
        anyRuns = true
        for (const r of job.runs) {
            if (!sameLocalDay(Date.parse(r.startedAt), now)) continue
            runCount++
            if (r.tokensIn > 0 || r.tokensOut > 0) {
                known++
                tokens += r.tokensIn + r.tokensOut
            }
        }
    }
    return {
        sample: false,
        values: {
            queued: { text: inStates('waiting', 'queued') },
            building: { text: inStates('building', 'fix_wait', 'fixing') },
            review: { text: inStates('review_wait', 'reviewing') },
            checks: { text: inStates('checks') },
            shipped: { text: String(snapshot.endedToday.merged) },
            runs: anyRuns ? { text: String(runCount) } : { ...NO_DATA },
            totalTokens: known > 0 ? { text: tokenText(tokens) } : { ...NO_DATA },
            cachedShare: { ...NO_DATA },
            avgDuration: { ...NO_DATA },
            errorRate: { ...NO_DATA },
            planWeek: { ...NO_DATA },
            signIn: { ...NO_DATA },
        },
    }
}
