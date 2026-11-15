import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FACTORY_SNAPSHOT_MAX_BYTES, factoryDepartmentSchema, factoryEpicKindSchema, factoryJobStateSchema, factorySnapshotSchema } from '@rerun/contracts'

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
        const table = readFileSync(path.join(ROOT, 'tools/factory/states.py'), 'utf8')
        const states = [...table.matchAll(/^    "([a-z_]+)": _(?:row|end)\(/gm)].map(m => m[1])
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

    it('accepts the old shape: no department, departments or epics', () => {
        const s = sample()
        for (const j of s.jobs) { delete j.department; delete j.departments }
        delete s.epics
        expect(factorySnapshotSchema.safeParse(s).success).toBe(true)
    })

    it('accepts the new shape in the sample: departments on jobs, epics on the snapshot', () => {
        const s = factorySnapshotSchema.parse(sample())
        expect(s.jobs[0].department).toBe('frontend')
        expect(s.jobs[1].departments).toEqual(['backend'])
        expect(s.jobs[3].department).toBeUndefined()
        expect(s.jobs[3].departments).toBeUndefined()
        expect(s.epics!.length).toBeGreaterThanOrEqual(1)
        for (const e of s.epics!) expect(factoryEpicKindSchema.options).toContain(e.kind)
    })

    it('holds the seven departments and the seven epic kinds', () => {
        expect(factoryDepartmentSchema.options).toEqual(['design', 'database', 'engine', 'backend', 'frontend', 'tooling', 'docs'])
        expect(factoryEpicKindSchema.options).toEqual(['feature', 'review_fix', 'fix', 'upgrade', 'refactor', 'research', 'other'])
    })

    it('refuses one past each new limit and an unknown department or kind', () => {
        const epic = () => sample().epics[0]
        const withEpics = (n: number) => { const s = sample(); s.epics = Array.from({ length: n }, () => epic()); return s }
        expect(factorySnapshotSchema.safeParse(withEpics(50)).success).toBe(true)
        expect(factorySnapshotSchema.safeParse(withEpics(51)).success).toBe(false)
        const title = (n: number) => { const s = sample(); s.epics[0].title = 'x'.repeat(n); return s }
        expect(factorySnapshotSchema.safeParse(title(256)).success).toBe(true)
        expect(factorySnapshotSchema.safeParse(title(257)).success).toBe(false)
        for (const poke of [
            (s: Sample) => { s.jobs[0].department = 'kitchen' },
            (s: Sample) => { s.jobs[0].departments = ['kitchen'] },
            (s: Sample) => { s.jobs[0].departments = Array.from({ length: 7 }, () => 'docs') },
            (s: Sample) => { s.epics[0].kind = 'dream' },
            (s: Sample) => { s.epics[0].extra = 1 },
            (s: Sample) => { s.epics[0].issue = 0 },
        ]) {
            const s = sample()
            poke(s)
            expect(factorySnapshotSchema.safeParse(s).success).toBe(false)
        }
    })

    it('accepts closedOutside: true on a job and the old shape without it', () => {
        const s = sample()
        const j = s.jobs.find((x: { issue: number }) => x.issue === 334)
        expect(j.closedOutside).toBe(true)
        expect(factorySnapshotSchema.safeParse(s).success).toBe(true)
        delete j.closedOutside
        expect(factorySnapshotSchema.safeParse(s).success).toBe(true)
    })

    it('refuses closedOutside false, a string or null', () => {
        for (const v of [false, 'true', null]) {
            const s = sample()
            s.jobs[0].closedOutside = v
            expect(factorySnapshotSchema.safeParse(s).success).toBe(false)
        }
    })
})
