import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema, type FactorySnapshot } from '@rerun/contracts'
import { barModel, METRICS } from './factory-metrics'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = (): FactorySnapshot => factorySnapshotSchema.parse(JSON.parse(readFileSync(SAMPLE, 'utf8')))
const counts = { queued: 3, building: 2, review: 1, checks: 1, merged: 4, runs: 5 }
const NOW = new Date(2026, 10, 14, 15, 0, 0).getTime()
const START = NOW - 5 * 60_000

const withRuns = (runs: ((typeof sample extends () => infer S ? S : never)['jobs'][number]['runs']) | undefined): FactorySnapshot => {
    const s = sample()
    return { ...s, jobs: s.jobs.map((j, i) => { const { runs: _drop, ...rest } = j; return i === 0 && runs ? { ...rest, runs } : rest }) }
}
const run = (startedAt: Date, tokensIn: number, tokensOut: number, cacheRead?: number) => ({
    stage: 'build', coworkerId: 'code', status: 'ok', startedAt: startedAt.toISOString(), endedAt: null, tokensIn, tokensOut, runId: null,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
})
const bar = (snapshot: FactorySnapshot | null, held = false) => barModel({ snapshot, counts, held, now: NOW, start: START })

describe('barModel', () => {
    it('without a snapshot keeps the sample numbers and the sample tag', () => {
        const m = bar(null)
        expect(m.sample).toBe(true)
        expect(m.values.runs.text).toBe('123')
        expect(m.values.cachedShare.text).toBe('87%')
        expect(m.values.signIn.text).toMatch(/min$/)
        expect(m.values.queued.text).toBe('3')
        const h = bar(null, true)
        expect(h.values.signIn).toMatchObject({ text: 'renewing', warn: true })
    })

    it('with a snapshot drops the sample tag and counts jobs by state', () => {
        const s = sample()
        const m = bar(s)
        expect(m.sample).toBe(false)
        expect(m.values.queued.text).toBe('1')
        expect(m.values.building.text).toBe('2')
        expect(m.values.review.text).toBe('1')
        expect(m.values.checks.text).toBe('0')
        expect(m.values.shipped.text).toBe(String(s.endedToday.merged))
    })

    it('counts the runs started today and sums their tokens, and shows a dash when no job has runs', () => {
        const today = new Date(2026, 10, 14, 9, 0, 0)
        const yesterday = new Date(2026, 10, 13, 23, 0, 0)
        const m = bar(withRuns([run(today, 300000, 300000), run(today, 200000, 200000), run(yesterday, 5000, 5000)]))
        expect(m.values.runs.text).toBe('2')
        expect(m.values.totalTokens.text).toBe('1.0M')
        const none = bar(withRuns(undefined))
        expect(none.values.runs).toEqual({ text: '—', title: 'no data yet' })
        expect(none.values.totalTokens).toEqual({ text: '—', title: 'no data yet' })
        expect(bar(withRuns([])).values.runs.text).toBe('0')
        expect(bar(withRuns([run(today, 1500, 0)])).values.totalTokens.text).toBe('2k')
        expect(bar(withRuns([run(today, 40, 2)])).values.totalTokens.text).toBe('42')
    })

    it('shows a dash with the title no data yet for avg run, errors, plan week and sign-in', () => {
        const m = bar(sample())
        for (const k of ['avgDuration', 'errorRate', 'planWeek', 'signIn'] as const) {
            expect(m.values[k]).toEqual({ text: '—', title: 'no data yet' })
        }
    })

    it('defines all twelve metrics, in the same order', () => {
        expect(METRICS.map(m => m.key)).toEqual(['queued', 'building', 'review', 'checks', 'shipped', 'runs', 'totalTokens', 'cachedShare', 'avgDuration', 'errorRate', 'planWeek', 'signIn'])
    })

    it('shows a dash for tokens when no run of today has a known count: none today, or all with tokensIn and tokensOut at 0', () => {
        const today = new Date(NOW - 60_000)
        const yesterday = new Date(NOW - 30 * 3_600_000)
        const dash = { text: '—', title: 'no data yet' }
        expect(bar(withRuns([run(today, 0, 0)])).values.totalTokens).toEqual(dash)
        expect(bar(withRuns([run(today, 0, 0), run(today, 0, 0)])).values.totalTokens).toEqual(dash)
        expect(bar(withRuns([run(yesterday, 900, 100)])).values.totalTokens).toEqual(dash)
        expect(bar(withRuns([run(today, 0, 0)])).values.runs.text).toBe('1')
    })

    it('adds only the known runs: a 0/0 run next to a counted one changes nothing, and 0 in one field alone is a known count', () => {
        const today = new Date(NOW - 60_000)
        expect(bar(withRuns([run(today, 0, 0), run(today, 1500, 0)])).values.totalTokens.text).toBe('2k')
        expect(bar(withRuns([run(today, 0, 40)])).values.totalTokens.text).toBe('40')
    })

    it('shows the share of input read from the cache over the runs started today', () => {
        const today = new Date(NOW - 60_000)
        const yesterday = new Date(NOW - 30 * 3_600_000)
        expect(bar(withRuns([run(today, 1000, 0, 800), run(today, 3000, 0, 1200), run(yesterday, 5000, 0, 0)])).values.cachedShare).toEqual({ text: '50%', fill: 50 })
        expect(bar(withRuns([run(today, 1000, 0, 1000)])).values.cachedShare.text).toBe('100%')
        expect(bar(withRuns([run(today, 1000, 0, 0)])).values.cachedShare.text).toBe('0%')
    })

    it('leaves runs with no cache count out of the share, and shows a dash when none has one', () => {
        const today = new Date(NOW - 60_000)
        const dash = { text: '—', title: 'no data yet' }
        expect(bar(withRuns([run(today, 1000, 0, 500), run(today, 9000, 0)])).values.cachedShare.text).toBe('50%')
        expect(bar(withRuns([run(today, 9000, 0)])).values.cachedShare).toEqual(dash)
        expect(bar(withRuns([])).values.cachedShare).toEqual(dash)
    })
})
