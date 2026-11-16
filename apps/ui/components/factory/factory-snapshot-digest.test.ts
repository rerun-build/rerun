import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema } from '@rerun/contracts'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = () => JSON.parse(readFileSync(SAMPLE, 'utf8'))

const digest = () => ({
    stations: [
        { station: 'build', queue: 2, oldestWaitS: 1800, serviceS: 900, inUse: 1 },
        { station: 'review', queue: 0, oldestWaitS: 0, serviceS: null, inUse: 0 },
    ],
    threads: [{ parent: 100, done: 1, total: 5, chain: 3, blockedBy: [14] }],
    anomalies: [
        { kind: 'past_clock', issue: 51, detail: 'clock is in the past' },
        { kind: 'proof_fail_rate', issue: null, detail: 'proofs fail often' },
    ],
    measures: {
        mergedPerHour: 0.08,
        leadTimeS: 5400,
        firstPassYield: 0.5,
        fixRounds: 0.5,
        blocks: { blocked: 1, rejected: 0, failed: 1, returned: 0 },
        tokensPerMerged: 2900,
    },
})

const loose = () => JSON.parse(JSON.stringify(digest()))
const withDigest = (d: unknown) => ({ ...sample(), digest: d })
const ok = (d: unknown) => factorySnapshotSchema.safeParse(withDigest(d)).success

describe('factory snapshot digest', () => {
    it('accepts the old shape with no digest', () => {
        expect(factorySnapshotSchema.safeParse(sample()).success).toBe(true)
    })

    it('accepts a full digest', () => {
        expect(ok(digest())).toBe(true)
    })

    it('accepts a digest with nothing measured yet', () => {
        expect(ok({
            stations: [],
            threads: [],
            anomalies: [],
            measures: {
                mergedPerHour: 0,
                leadTimeS: null,
                firstPassYield: null,
                fixRounds: null,
                blocks: { blocked: 0, rejected: 0, failed: 0, returned: 0 },
                tokensPerMerged: null,
            },
        })).toBe(true)
    })

    it('refuses an anomaly kind it does not know', () => {
        const d = digest()
        d.anomalies[0].kind = 'slow'
        expect(ok(d)).toBe(false)
    })

    it('refuses a rate above 1 and a negative number', () => {
        const a = digest()
        a.measures.firstPassYield = 1.5
        expect(ok(a)).toBe(false)
        const b = digest()
        b.measures.mergedPerHour = -1
        expect(ok(b)).toBe(false)
    })

    it('drops an unknown key at every level of the digest', () => {
        const pokes = [
            (d: ReturnType<typeof loose>) => { d.x = 1 },
            (d: ReturnType<typeof loose>) => { d.stations[0].x = 1 },
            (d: ReturnType<typeof loose>) => { d.threads[0].x = 1 },
            (d: ReturnType<typeof loose>) => { d.anomalies[0].x = 1 },
            (d: ReturnType<typeof loose>) => { d.measures.x = 1 },
            (d: ReturnType<typeof loose>) => { d.measures.blocks.x = 1 },
        ]
        for (const poke of pokes) {
            const d = digest()
            poke(d)
            expect(ok(d)).toBe(true)
        }
    })

    it('refuses one past each limit and accepts each limit', () => {
        const station = { station: 'a'.repeat(20), queue: 0, oldestWaitS: 0, serviceS: null, inUse: 0 }
        const thread = { parent: 1, done: 0, total: 0, chain: 0, blockedBy: Array.from({ length: 20 }, (_, i) => i + 1) }
        const anomaly = { kind: 'budget_burn', issue: null, detail: 'd'.repeat(200) }
        const build = (patch: (d: ReturnType<typeof loose>) => void) => {
            const d = loose()
            d.stations = [station]
            d.threads = [thread]
            d.anomalies = [anomaly]
            patch(d)
            return d
        }
        expect(ok(build(() => undefined))).toBe(true)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.stations = Array(12).fill(station) }))).toBe(true)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.stations = Array(13).fill(station) }))).toBe(false)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.threads = Array(50).fill(thread) }))).toBe(true)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.threads = Array(51).fill(thread) }))).toBe(false)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.threads = [{ ...thread, blockedBy: [...thread.blockedBy, 21] }] }))).toBe(false)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.anomalies = Array(50).fill(anomaly) }))).toBe(true)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.anomalies = Array(51).fill(anomaly) }))).toBe(false)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.anomalies[0].detail = 'd'.repeat(201) }))).toBe(false)
        expect(ok(build((d: ReturnType<typeof loose>) => { d.stations[0].station = 'a'.repeat(21) }))).toBe(false)
    })

    it('keeps a digest with the most it can hold under 64 KiB', () => {
        const d = loose()
        d.stations = Array(12).fill({ station: 'a'.repeat(20), queue: 999999, oldestWaitS: 999999, serviceS: 999999.5, inUse: 999999 })
        d.threads = Array(50).fill({ parent: 999999, done: 999999, total: 999999, chain: 999999, blockedBy: Array.from({ length: 20 }, (_, i) => 900000 + i) })
        d.anomalies = Array(50).fill({ kind: 'repeat_block', issue: 999999, detail: 'd'.repeat(200) })
        d.planners = Array(20).fill({ planner: 'p'.repeat(64), cut: 999999, merged: 999999, firstPass: 999999, firstPassYield: 0.123456789, stopped: 999999, replans: 999999 })
        expect(ok(d)).toBe(true)
        expect(Buffer.byteLength(JSON.stringify(d), 'utf8')).toBeLessThan(64 * 1024)
    })

    const plannerRow = { planner: 'coder', cut: 4, merged: 3, firstPass: 2, firstPassYield: 0.5, stopped: 1, replans: 2 }

    it('keeps the planners of a digest', () => {
        const parsed = factorySnapshotSchema.parse(withDigest({ ...digest(), planners: [plannerRow] }))
        expect(parsed.digest?.planners).toEqual([plannerRow])
    })

    it('accepts a digest without planners', () => {
        expect(ok(digest())).toBe(true)
    })

    it('refuses one past each planners limit and accepts each limit', () => {
        const with_ = (planners: unknown[]) => ok({ ...digest(), planners })
        expect(with_(Array(20).fill(plannerRow))).toBe(true)
        expect(with_(Array(21).fill(plannerRow))).toBe(false)
        expect(with_([{ ...plannerRow, planner: 'a'.repeat(64) }])).toBe(true)
        expect(with_([{ ...plannerRow, planner: 'a'.repeat(65) }])).toBe(false)
        expect(with_([{ ...plannerRow, firstPassYield: 1 }])).toBe(true)
        expect(with_([{ ...plannerRow, firstPassYield: null }])).toBe(true)
        expect(with_([{ ...plannerRow, firstPassYield: 1.1 }])).toBe(false)
        expect(with_([{ ...plannerRow, cut: -1 }])).toBe(false)
    })

    const win = { solved: 4, solvedGreen: 3, tokensPerIssue: 1200.5, firstPassYield: 0.75, escaped: 1 }
    const bar = { day: win, week: { ...win, solved: 20, solvedGreen: 18 } }

    it('accepts a digest with the bar of a day and of a week, and keeps its numbers', () => {
        const parsed = factorySnapshotSchema.parse(withDigest({ ...digest(), bar }))
        expect(parsed.digest?.bar?.day).toEqual(win)
        expect(parsed.digest?.bar?.week).toEqual(bar.week)
    })

    it('accepts a bar with nothing solved: no tokens per issue and no yield', () => {
        const empty = { solved: 0, solvedGreen: 0, tokensPerIssue: null, firstPassYield: null, escaped: 0 }
        expect(ok({ ...digest(), bar: { day: empty, week: empty } })).toBe(true)
    })

    it('refuses a bar with a negative count, a yield above 1 or a window missing', () => {
        const with_ = (day: unknown) => ok({ ...digest(), bar: { day, week: win } })
        expect(with_(win)).toBe(true)
        expect(with_({ ...win, solvedGreen: -1 })).toBe(false)
        expect(with_({ ...win, escaped: 1.5 })).toBe(false)
        expect(with_({ ...win, firstPassYield: 1.1 })).toBe(false)
        expect(with_({ ...win, tokensPerIssue: -1 })).toBe(false)
        expect(ok({ ...digest(), bar: { day: win } })).toBe(false)
    })

    const groups = [
        { group: 'proof', events: 5, rate: 0.5, state: 'open' },
        { group: 'review', events: 3, rate: null, state: 'changed' },
        { group: 'ci', events: 2, rate: 0.1, state: 'kept' },
    ]
    const changes = [
        { issue: 300, group: 'proof', kind: 'repo', before: null, after: null, verdict: null, revert: null },
        { issue: 310, group: 'review', kind: 'instructions', before: 0.4, after: 0.6, verdict: 'revert', revert: 310 },
        { issue: 320, group: 'ci', kind: 'repo', before: 0.2, after: 0.1, verdict: 'kept', revert: null },
        { issue: 330, group: 'ci', kind: 'repo', before: 0.2, after: 0.2, verdict: 'dropped', revert: null },
    ]

    it('accepts a digest with the open groups and the changes with their before and after', () => {
        const parsed = factorySnapshotSchema.parse(withDigest({ ...digest(), causes: { groups, changes } }))
        expect(parsed.digest?.causes?.groups).toEqual(groups)
        expect(parsed.digest?.causes?.changes[1]).toEqual(changes[1])
    })

    it('accepts causes with nothing in them', () => {
        expect(ok({ ...digest(), causes: { groups: [], changes: [] } })).toBe(true)
    })

    it('refuses a group state, a change kind or a verdict it does not know, and a negative rate', () => {
        const g = (row: unknown) => ok({ ...digest(), causes: { groups: [row], changes: [] } })
        const c = (row: unknown) => ok({ ...digest(), causes: { groups: [], changes: [row] } })
        expect(g({ ...groups[0], state: 'closed' })).toBe(false)
        expect(g({ ...groups[0], rate: -0.1 })).toBe(false)
        expect(c({ ...changes[1], kind: 'config' })).toBe(false)
        expect(c({ ...changes[1], verdict: 'merged' })).toBe(false)
        expect(c({ ...changes[1], issue: 0 })).toBe(false)
    })

    it('refuses one past each causes limit and accepts each limit', () => {
        const g = (rows: unknown[]) => ok({ ...digest(), causes: { groups: rows, changes: [] } })
        const c = (rows: unknown[]) => ok({ ...digest(), causes: { groups: [], changes: rows } })
        expect(g(Array(20).fill(groups[0]))).toBe(true)
        expect(g(Array(21).fill(groups[0]))).toBe(false)
        expect(c(Array(20).fill(changes[1]))).toBe(true)
        expect(c(Array(21).fill(changes[1]))).toBe(false)
        expect(g([{ ...groups[0], group: 'a'.repeat(80) }])).toBe(true)
        expect(g([{ ...groups[0], group: 'a'.repeat(81) }])).toBe(false)
    })
})
