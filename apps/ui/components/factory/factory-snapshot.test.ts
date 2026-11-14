import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FACTORY_SNAPSHOT_MAX_BYTES, factoryJobStateSchema, factorySnapshotSchema } from '@rerun/contracts'

// The picture the delegator pushes each beat. The sample in packages/contracts/fixtures is the one
// the delegator's own report is to be tested against too.
const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = () => JSON.parse(readFileSync(SAMPLE, 'utf8'))
type Sample = ReturnType<typeof sample>

describe('factorySnapshotSchema', () => {
    it('accepts the shared sample and keeps it under the byte cap', () => {
        const text = readFileSync(SAMPLE, 'utf8')
        expect(factorySnapshotSchema.parse(JSON.parse(text)).jobs).toHaveLength(6)
        expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(FACTORY_SNAPSHOT_MAX_BYTES)
    })

    it('holds the same job states as the delegator ledger', () => {
        const store = readFileSync(path.join(ROOT, 'tools/factory/store.py'), 'utf8')
        const block = store.match(/JOB_STATES = \(([\s\S]*?)\)/)
        expect(block).not.toBeNull()
        const states = [...block![1].matchAll(/"([a-z_]+)"/g)].map(m => m[1])
        expect(states).toEqual(factoryJobStateSchema.options)
    })

    it('refuses a state the ledger does not have', () => {
        const s = sample()
        s.jobs[0].state = 'cancelled'
        expect(factorySnapshotSchema.safeParse(s).success).toBe(false)
    })

    it('refuses fields it does not know, at every level', () => {
        expect(factorySnapshotSchema.safeParse({ ...sample(), extra: 1 }).success).toBe(false)
        for (const poke of [
            (s: Sample) => { s.jobs[0].secret = 'x' },
            (s: Sample) => { s.holds[0].x = 1 },
            (s: Sample) => { s.pools[0].coworkers[0].x = 1 },
            (s: Sample) => { s.jobs[0].history[0].x = 1 },
            (s: Sample) => { s.jobs[0].runs[0].x = 1 },
            (s: Sample) => { s.endedToday.x = 1 },
        ]) {
            const s = sample()
            poke(s)
            expect(factorySnapshotSchema.safeParse(s).success).toBe(false)
        }
    })

    it('refuses an over-long title, a time with no offset or an endless time, and more than 300 jobs', () => {
        const long = sample()
        long.jobs[0].title = 'x'.repeat(257)
        expect(factorySnapshotSchema.safeParse(long).success).toBe(false)
        const ok = sample()
        ok.jobs[0].title = 'x'.repeat(256)
        expect(factorySnapshotSchema.safeParse(ok).success).toBe(true)
        const noOffset = sample()
        noOffset.madeAt = '2026-11-14T03:24:30'
        expect(factorySnapshotSchema.safeParse(noOffset).success).toBe(false)
        const endless = sample()
        endless.madeAt = `2026-11-14T03:24:30.${'1'.repeat(100)}Z`
        expect(factorySnapshotSchema.safeParse(endless).success).toBe(false)
        const many = sample()
        many.jobs = Array.from({ length: 301 }, (_, i) => ({ ...many.jobs[0], issue: 1000 + i }))
        expect(factorySnapshotSchema.safeParse(many).success).toBe(false)
    })

    it('accepts the old shape: no history, runs or pool ids', () => {
        const s = sample()
        for (const j of s.jobs) { delete j.history; delete j.runs }
        for (const p of s.pools) for (const c of p.coworkers) delete c.id
        expect(factorySnapshotSchema.safeParse(s).success).toBe(true)
    })

    it('accepts the new shape in the sample, with history, runs and pool ids', () => {
        const s = factorySnapshotSchema.parse(sample())
        for (const i of [0, 1, 5]) {
            expect(s.jobs[i].history!.length).toBeGreaterThanOrEqual(2)
            expect(s.jobs[i].runs!.length).toBeGreaterThanOrEqual(1)
        }
        expect(s.jobs[5].history!.at(-1)!.state).toBe('merged')
        expect(s.jobs[3].history).toBeUndefined()
        expect(s.jobs[4].runs).toBeUndefined()
        expect(s.jobs[0].runs!.some(r => r.endedAt === null)).toBe(true)
        for (const p of s.pools) for (const c of p.coworkers) expect(c.id).toBeTruthy()
    })

    it('refuses one past each new limit', () => {
        const cases: Array<[string, (s: Sample, n: number) => void, number]> = [
            ['history entries', (s, n) => { s.jobs[0].history = Array.from({ length: n }, () => ({ ...s.jobs[0].history[0] })) }, 30],
            ['history reason', (s, n) => { s.jobs[0].history[0].reason = 'x'.repeat(n) }, 300],
            ['history runId', (s, n) => { s.jobs[0].history[0].runId = 'x'.repeat(n) }, 64],
            ['runs', (s, n) => { s.jobs[0].runs = Array.from({ length: n }, () => ({ ...s.jobs[0].runs[0] })) }, 12],
            ['run stage', (s, n) => { s.jobs[0].runs[0].stage = 'x'.repeat(n) }, 20],
            ['run coworkerId', (s, n) => { s.jobs[0].runs[0].coworkerId = 'x'.repeat(n) }, 64],
            ['run status', (s, n) => { s.jobs[0].runs[0].status = 'x'.repeat(n) }, 20],
            ['run runId', (s, n) => { s.jobs[0].runs[0].runId = 'x'.repeat(n) }, 64],
            ['pool id', (s, n) => { s.pools[0].coworkers[0].id = 'x'.repeat(n) }, 64],
        ]
        for (const [name, poke, limit] of cases) {
            const at = sample()
            poke(at, limit)
            expect(factorySnapshotSchema.safeParse(at).success, `${name} at ${limit}`).toBe(true)
            const past = sample()
            poke(past, limit + 1)
            expect(factorySnapshotSchema.safeParse(past).success, `${name} at ${limit + 1}`).toBe(false)
        }
    })

    it('refuses a history state the ledger does not have', () => {
        const s = sample()
        s.jobs[0].history[0].state = 'cancelled'
        expect(factorySnapshotSchema.safeParse(s).success).toBe(false)
    })

    it('refuses an unknown key inside a history entry or a run', () => {
        const a = sample()
        a.jobs[0].history[0].extra = 1
        expect(factorySnapshotSchema.safeParse(a).success).toBe(false)
        const b = sample()
        b.jobs[0].runs[0].extra = 1
        expect(factorySnapshotSchema.safeParse(b).success).toBe(false)
    })
})
