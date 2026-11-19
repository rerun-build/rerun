import type { FactorySnapshot } from '@moldwright/contracts'

export type MetricKey =
    | 'queued' | 'building' | 'review' | 'checks' | 'solvedGreen'
    | 'tokensPerIssue' | 'escaped' | 'totalTokens' | 'cachedShare' | 'avgDuration' | 'errorRate'
    | 'planWeek' | 'signIn'

export type MetricGroup = 'jobs' | 'runs' | 'plan'

export type MetricDef = { key: MetricKey; group: MetricGroup; label: string; definition: string; source: string }

export const METRICS: MetricDef[] = [
    { key: 'queued', group: 'jobs', label: 'Queued', definition: 'Issues the delegator has taken and not yet sent to a builder.', source: 'ledger: jobs waiting or queued' },
    { key: 'building', group: 'jobs', label: 'Building', definition: 'Builds and fixes running now, every copy counted.', source: 'ledger: jobs building or fixing' },
    { key: 'review', group: 'jobs', label: 'Review', definition: 'Reviews running now.', source: 'ledger: jobs reviewing' },
    { key: 'checks', group: 'jobs', label: 'Checks', definition: 'Approved pull requests waiting for their workflow runs.', source: 'ledger: jobs in checks' },
    { key: 'solvedGreen', group: 'jobs', label: 'Solved green', definition: 'Issues solved and committed green to main in the last 24 hours.', source: 'digest: bar.day.solvedGreen' },
    { key: 'tokensPerIssue', group: 'jobs', label: 'Tokens per issue', definition: 'Tokens spent per issue solved green in the last 24 hours.', source: 'digest: bar.day.tokensPerIssue' },
    { key: 'escaped', group: 'jobs', label: 'Escaped', definition: 'Issues that reached main and then failed in the last 24 hours.', source: 'digest: bar.day.escaped' },
    { key: 'totalTokens', group: 'runs', label: 'Tokens', definition: 'Total tokens used by the factory coworkers today.', source: 'started today, from the ledger runs of the snapshot' },
    { key: 'cachedShare', group: 'runs', label: 'Cached', definition: 'Share of input tokens read from the cache.', source: 'stats: cachedInputTokens / inputTokens, 24h' },
    { key: 'avgDuration', group: 'runs', label: 'Avg run', definition: 'Average duration of a run.', source: 'snapshot: runStats.avgRunS, 24 h' },
    { key: 'errorRate', group: 'runs', label: 'Errors', definition: 'Share of runs that ended in error.', source: 'snapshot: runStats.errors / finished, 24 h' },
    { key: 'planWeek', group: 'plan', label: 'Plan week', definition: 'Share of the Claude plan weekly window used.', source: 'snapshot: plan.weekUsedPercent' },
    { key: 'signIn', group: 'plan', label: 'Sign-in', definition: 'Minutes until the Claude sign-in expires; near the end the delegator holds sending.', source: 'snapshot: plan.signInMinutes' },
]

export type MetricValues = Record<MetricKey, { text: string; fill?: number; warn?: boolean; title?: string }>

type BarCounts = { queued: number; building: number; review: number; checks: number; merged: number; runs: number }

const NO_DATA = { text: '—', title: 'no data yet' }
const ERROR_WARN_PERCENT = 10
const PLAN_WARN_PERCENT = 90
const SIGN_IN_WARN_MIN = 50
const SIGN_IN_FULL_MIN = 480

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

function durationText(seconds: number): string {
    const t = Math.round(seconds)
    if (t >= 3600) return `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`
    if (t >= 60) return `${Math.floor(t / 60)}m ${t % 60}s`
    return `${t}s`
}

function errorRateValue(errors: number, finished: number) {
    const share = (errors / finished) * 100
    return { text: errors === 0 ? '0%' : `${share.toFixed(1)}%`, title: `${errors} of ${finished} runs in 24 h`, warn: share >= ERROR_WARN_PERCENT }
}

function planWeekValue(used: number, resetsAt: string | null) {
    const n = Math.round(used)
    return { text: `${n}%`, fill: n, warn: used >= PLAN_WARN_PERCENT, ...(resetsAt ? { title: `resets ${resetsAt.slice(0, 16).replace('T', ' ')} UTC` } : {}) }
}

function signInValue(minutes: number) {
    return { text: `${minutes} min`, fill: Math.min(100, (minutes / SIGN_IN_FULL_MIN) * 100), warn: minutes <= SIGN_IN_WARN_MIN }
}

function cachedShareValue(cached: number, input: number) {
    const n = Math.round((cached / input) * 100)
    return { text: `${n}%`, fill: n }
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
                solvedGreen: { text: String(counts.merged) },
                tokensPerIssue: { text: '0.8M' },
                escaped: { text: '0' },
                totalTokens: { text: `${(runs * 0.31).toFixed(1)}M` },
                cachedShare: { text: '87%', fill: 87 },
                avgDuration: { text: '2m 41s' },
                errorRate: { text: '1.7%' },
                planWeek: { text: '56%', fill: 56 },
                signIn: held ? { text: 'renewing', fill: 2, warn: true } : { text: `${signInMin} min`, fill: Math.min(100, (signInMin / 480) * 100) },
            },
        }
    }
    const day = snapshot.digest?.bar?.day
    const inStates = (...states: string[]) => String(snapshot.jobs.filter(j => states.includes(j.state)).length)
    let tokens = 0
    const { runStats: stats, plan } = snapshot
    let known = 0
    let cacheInput = 0
    let cacheHits = 0
    for (const job of snapshot.jobs) {
        if (!job.runs) continue
        for (const r of job.runs) {
            if (!sameLocalDay(Date.parse(r.startedAt), now)) continue
            if (r.cacheRead !== undefined) {
                cacheInput += r.tokensIn
                cacheHits += r.cacheRead
            }
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
            review: { text: inStates('review_wait', 'reviewing', 'proof_wait', 'proving') },
            checks: { text: inStates('checks') },
            solvedGreen: day ? { text: String(day.solvedGreen) } : { ...NO_DATA },
            tokensPerIssue: day && day.tokensPerIssue !== null ? { text: tokenText(Math.round(day.tokensPerIssue)) } : { ...NO_DATA },
            escaped: day ? { text: String(day.escaped), warn: day.escaped > 0 } : { ...NO_DATA },
            totalTokens: known > 0 ? { text: tokenText(tokens) } : { ...NO_DATA },
            cachedShare: cacheInput > 0 ? cachedShareValue(cacheHits, cacheInput) : { ...NO_DATA },
            avgDuration: stats && stats.avgRunS !== null ? { text: durationText(stats.avgRunS) } : { ...NO_DATA },
            errorRate: stats && stats.finished > 0 ? errorRateValue(stats.errors, stats.finished) : { ...NO_DATA },
            planWeek: plan && plan.weekUsedPercent !== null ? planWeekValue(plan.weekUsedPercent, plan.weekResetsAt) : { ...NO_DATA },
            signIn: plan && plan.signInMinutes !== null ? signInValue(plan.signInMinutes) : { ...NO_DATA },
        },
    }
}
