import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema } from '@rerun/contracts'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = () => JSON.parse(readFileSync(SAMPLE, 'utf8'))

const row = (name: string) => ({ name, runs: 2, tokens: 1000, units: 1.5, unitsPerIssue: 0.75 })

const digest = () => ({
    stations: [{ station: 'build', queue: 2, oldestWaitS: 1800, serviceS: 900, inUse: 1 }],
    threads: [{ parent: 100, done: 1, total: 5, chain: 3, blockedBy: [14] }],
    anomalies: [
        { kind: 'past_clock', issue: 51, detail: 'clock is in the past' },
        { kind: 'rework', issue: 52, detail: 'second round on the same issue' },
    ],
    measures: {
        mergedPerHour: 0.08,
        leadTimeS: 5400,
        firstPassYield: 0.5,
        fixRounds: 0.5,
        blocks: { blocked: 1, rejected: 0, failed: 1, returned: 0 },
        tokensPerMerged: 2900,
        reworkPerSolved: 1.9,
        reworkUnitsPerSolved: 0.8,
    },
    bar: {
        day: { solved: 3, solvedGreen: 3, tokensPerIssue: 900, firstPassYield: 0.5, escaped: 0, costPerIssue: 0.21 },
        week: { solved: 9, solvedGreen: 8, tokensPerIssue: 1000, firstPassYield: 0.6, escaped: 1, costPerIssue: 0.2 },
    },
    cost: {
        perIssue: 0.21,
        byStation: [row('build')],
        byModel: [row('sonnet')],
        byThinking: [row('medium'), row('none')],
        unweighed: ['local-model'],
        calibration: { state: 'uncalibrated', unitsPerPlanPercent: null },
    },
})

const withDigest = (d: unknown) => ({ ...sample(), digest: d })
const ok = (d: unknown) => factorySnapshotSchema.safeParse(withDigest(d)).success
const list = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i))
const withCost = (patch: Record<string, unknown>) => {
    const d = digest()
    return { ...d, cost: { ...d.cost, ...patch } }
}

describe('factory snapshot cost, rework and cost per issue', () => {
    it('keeps the rework measures, the cost per issue and the cost block', () => {
        const parsed = factorySnapshotSchema.parse(withDigest(digest()))
        const d = parsed.digest
        expect(d?.measures.reworkPerSolved).toBe(1.9)
        expect(d?.measures.reworkUnitsPerSolved).toBe(0.8)
        expect(d?.bar?.day.costPerIssue).toBe(0.21)
        expect(d?.cost?.byThinking.map((r) => r.name)).toEqual(['medium', 'none'])
        expect(d?.cost?.calibration).toEqual({ state: 'uncalibrated', unitsPerPlanPercent: null })
        expect(d?.anomalies[1].kind).toBe('rework')
    })

    it('accepts the old shape: no rework measures, no costPerIssue, no cost block', () => {
        const d = digest()
        delete (d as Record<string, unknown>).cost
        delete (d.measures as Record<string, unknown>).reworkPerSolved
        delete (d.measures as Record<string, unknown>).reworkUnitsPerSolved
        delete (d.bar.day as Record<string, unknown>).costPerIssue
        d.anomalies[1].kind = 'proof_fail_rate' as 'rework'
        expect(ok(d)).toBe(true)
    })

    it('refuses one past each new limit', () => {
        expect(ok(withCost({ byStation: list(12, (i) => row(`s${i}`)) }))).toBe(true)
        expect(ok(withCost({ byStation: list(13, (i) => row(`s${i}`)) }))).toBe(false)
        expect(ok(withCost({ byModel: list(12, (i) => row(`m${i}`)) }))).toBe(true)
        expect(ok(withCost({ byModel: list(13, (i) => row(`m${i}`)) }))).toBe(false)
        expect(ok(withCost({ byThinking: list(6, (i) => row(`t${i}`)) }))).toBe(true)
        expect(ok(withCost({ byThinking: list(7, (i) => row(`t${i}`)) }))).toBe(false)
        expect(ok(withCost({ unweighed: list(12, (i) => `u${i}`) }))).toBe(true)
        expect(ok(withCost({ unweighed: list(13, (i) => `u${i}`) }))).toBe(false)
        expect(ok(withCost({ byStation: [row('x'.repeat(64))] }))).toBe(true)
        expect(ok(withCost({ byStation: [row('x'.repeat(65))] }))).toBe(false)
        expect(ok(withCost({ unweighed: ['x'.repeat(64)] }))).toBe(true)
        expect(ok(withCost({ unweighed: ['x'.repeat(65)] }))).toBe(false)
    })

    it('refuses negative numbers, an unknown calibration state and unknown keys in the cost block', () => {
        expect(ok(digest())).toBe(true)
        const bad = (mutate: (d: ReturnType<typeof digest>) => void) => {
            const d = digest()
            mutate(d)
            return ok(d)
        }
        expect(bad((d) => { d.measures.reworkPerSolved = -1 })).toBe(false)
        expect(bad((d) => { d.measures.reworkUnitsPerSolved = -0.1 })).toBe(false)
        expect(bad((d) => { d.bar.week.costPerIssue = -1 } )).toBe(false)
        expect(bad((d) => { d.bar.day.costPerIssue = -1 })).toBe(false)
        expect(bad((d) => { d.cost.perIssue = -1 })).toBe(false)
        expect(bad((d) => { d.cost.byStation[0].units = -1 })).toBe(false)
        expect(bad((d) => { d.cost.calibration.state = 'guessed' as 'calibrated' })).toBe(false)
        expect(bad((d) => { (d.cost.calibration as { unitsPerPlanPercent: number | null }).unitsPerPlanPercent = -2 })).toBe(false)
        expect(bad((d) => { (d.cost as Record<string, unknown>).extra = 1 })).toBe(false)
        expect(bad((d) => { (d.cost.byStation[0] as Record<string, unknown>).extra = 1 })).toBe(false)
        expect(bad((d) => { d.anomalies[0].kind = 'reworks' as 'rework' })).toBe(false)
    })
})
