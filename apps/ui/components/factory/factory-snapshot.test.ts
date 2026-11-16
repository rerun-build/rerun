import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FACTORY_SNAPSHOT_MAX_BYTES, factoryDepartmentSchema, factoryDigestSchema, factoryEpicKindSchema, factoryJobStateSchema, factorySnapshotSchema } from '@rerun/contracts'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = () => JSON.parse(readFileSync(SAMPLE, 'utf8'))
type Sample = ReturnType<typeof sample>
type Snap = ReturnType<typeof factorySnapshotSchema.parse>

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

    it('drops an unknown key at the top and inside a job, and still refuses a known key with a wrong type', () => {
        const s = sample()
        s.future = { a: 1 }
        s.jobs[0].future = 'x'
        const r = factorySnapshotSchema.safeParse(s)
        expect(r.success).toBe(true)
        if (!r.success) return
        expect('future' in r.data).toBe(false)
        expect('future' in r.data.jobs[0]).toBe(false)
        expect(r.data.jobs[0]).toEqual(factorySnapshotSchema.parse(sample()).jobs[0])
        const wrongIssue = sample()
        wrongIssue.jobs[0].issue = '330'
        expect(factorySnapshotSchema.safeParse(wrongIssue).success).toBe(false)
        const wrongBeat = sample()
        wrongBeat.beat = -1
        expect(factorySnapshotSchema.safeParse(wrongBeat).success).toBe(false)
    })

    it('drops fields it does not know, at every level', () => {
        const top = factorySnapshotSchema.safeParse({ ...sample(), extra: 1 })
        expect(top.success).toBe(true)
        if (top.success) expect('extra' in top.data).toBe(false)
        for (const [poke, read] of [
            [(s: Sample) => { s.jobs[0].secret = 'x' }, (d: Snap) => d.jobs[0]],
            [(s: Sample) => { s.holds[0].x = 1 }, (d: Snap) => d.holds[0]],
            [(s: Sample) => { s.pools[0].coworkers[0].x = 1 }, (d: Snap) => d.pools[0].coworkers[0]],
            [(s: Sample) => { s.jobs[0].history[0].x = 1 }, (d: Snap) => d.jobs[0]!.history![0]!],
            [(s: Sample) => { s.jobs[0].runs[0].x = 1 }, (d: Snap) => d.jobs[0]!.runs![0]!],
            [(s: Sample) => { s.endedToday.x = 1 }, (d: Snap) => d.endedToday],
        ] as Array<[(s: Sample) => void, (d: Snap) => object]>) {
            const s = sample()
            poke(s)
            const r = factorySnapshotSchema.safeParse(s)
            expect(r.success).toBe(true)
            if (r.success) {
                const node = read(r.data)
                expect('x' in node || 'secret' in node).toBe(false)
            }
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

    it('drops an unknown key inside a history entry or a run', () => {
        const a = sample()
        a.jobs[0].history[0].extra = 1
        const ra = factorySnapshotSchema.safeParse(a)
        expect(ra.success).toBe(true)
        if (ra.success) expect('extra' in ra.data.jobs[0]!.history![0]!).toBe(false)
        const b = sample()
        b.jobs[0].runs[0].extra = 1
        const rb = factorySnapshotSchema.safeParse(b)
        expect(rb.success).toBe(true)
        if (rb.success) expect('extra' in rb.data.jobs[0]!.runs![0]!).toBe(false)
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
            (s: Sample) => { s.epics[0].issue = 0 },
        ]) {
            const s = sample()
            poke(s)
            expect(factorySnapshotSchema.safeParse(s).success).toBe(false)
        }
    })

    it('drops an unknown key inside an epic', () => {
        const s = sample()
        s.epics[0].extra = 1
        const r = factorySnapshotSchema.safeParse(s)
        expect(r.success).toBe(true)
        if (r.success) expect('extra' in r.data.epics![0]).toBe(false)
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

    const runStats = () => ({ since: '2026-11-09T12:00:00Z', finished: 12, errors: 2, avgRunS: 161.5 })
    const plan = () => ({ weekUsedPercent: 56, weekResetsAt: '2026-11-14T08:00:00Z', signInMinutes: 412 })
    const ok = (s: unknown) => factorySnapshotSchema.safeParse(s).success

    it('accepts the old shape: no runStats and no plan', () => {
        const s = sample()
        expect('runStats' in s).toBe(false)
        expect('plan' in s).toBe(false)
        expect(ok(s)).toBe(true)
    })

    it('accepts runStats and plan', () => {
        const r = factorySnapshotSchema.safeParse({ ...sample(), runStats: runStats(), plan: plan() })
        expect(r.success).toBe(true)
        if (r.success) {
            expect(r.data.runStats?.finished).toBe(12)
            expect(r.data.plan?.signInMinutes).toBe(412)
        }
    })

    it('accepts null avgRunS, weekUsedPercent, weekResetsAt and signInMinutes', () => {
        const s = { ...sample(), runStats: { ...runStats(), avgRunS: null }, plan: { weekUsedPercent: null, weekResetsAt: null, signInMinutes: null } }
        expect(ok(s)).toBe(true)
    })

    it('refuses one past each limit', () => {
        const cases: Array<[string, string, number, number]> = [
            ['runStats', 'finished', -1, 0],
            ['runStats', 'errors', 1.5, 0],
            ['runStats', 'avgRunS', -1, 0],
            ['plan', 'weekUsedPercent', -1, 0],
            ['plan', 'weekUsedPercent', 100.5, 100],
            ['plan', 'signInMinutes', -1, 0],
        ]
        for (const [key, field, bad, good] of cases) {
            const base = { runStats: runStats(), plan: plan() } as Record<string, Record<string, unknown>>
            expect(ok({ ...sample(), ...base, [key]: { ...base[key], [field]: bad } })).toBe(false)
            expect(ok({ ...sample(), ...base, [key]: { ...base[key], [field]: good } })).toBe(true)
        }
    })

    it('refuses an unknown key inside runStats or plan', () => {
        expect(ok({ ...sample(), runStats: { ...runStats(), extra: 1 } })).toBe(false)
        expect(ok({ ...sample(), plan: { ...plan(), extra: 1 } })).toBe(false)
    })
})

describe('factoryMachineSchema', () => {
    const machine = () => ({
        fileMadeAt: '2026-11-16T10:00:00Z',
        fileAgeS: 42,
        fresh: true,
        engine: 'running',
        skippedTicks: 0,
        readings: [
            { name: 'cpu', value: 12.5, reason: null, source: 'keeper' },
            { name: 'disk', value: 'ok', reason: null, source: 'factory' },
            { name: 'queue', value: null, reason: 'no reading', source: 'dispatcher' },
        ],
        housekeeping: [{ cmd: 'prune', rc: 0, s: 2 }],
    })
    const ok = (v: unknown) => factorySnapshotSchema.safeParse({ ...sample(), machine: v }).success

    it('accepts a snapshot without machine, and one with machine in the snapshot and in the digest', () => {
        expect(factorySnapshotSchema.safeParse(sample()).success).toBe(true)
        const r = factorySnapshotSchema.safeParse({ ...sample(), machine: machine() })
        expect(r.success).toBe(true)
        if (!r.success) return
        expect(r.data.machine?.readings).toHaveLength(3)
        expect(r.data.machine?.readings.map(x => x.source)).toEqual(['keeper', 'factory', 'dispatcher'])
        expect(r.data.machine?.readings[2].value).toBeNull()
        expect(factoryDigestSchema.pick({ machine: true }).parse({ machine: machine() }).machine?.fileAgeS).toBe(42)
    })

    it('accepts a stale file whose every value is unknown', () => {
        const stale = {
            fileMadeAt: null,
            fileAgeS: null,
            fresh: false,
            engine: 'unknown',
            skippedTicks: 0,
            readings: [{ name: 'cpu', value: null, reason: 'stale', source: 'keeper' }],
            housekeeping: [],
        }
        const r = factorySnapshotSchema.safeParse({ ...sample(), machine: stale })
        expect(r.success).toBe(true)
        if (!r.success) return
        expect(r.data.machine?.fresh).toBe(false)
        expect(r.data.machine?.fileAgeS).toBeNull()
        expect(r.data.machine?.engine).toBe('unknown')
    })

    it('refuses an unknown key, an unknown source and a long value at every level of machine', () => {
        expect(ok({ ...machine(), extra: 1 })).toBe(false)
        const m1 = machine(); Object.assign(m1.readings[0], { extra: 1 })
        expect(ok(m1)).toBe(false)
        const m2 = machine(); Object.assign(m2.housekeeping[0], { extra: 1 })
        expect(ok(m2)).toBe(false)
        const m3 = machine(); m3.readings[0].source = 'model'
        expect(ok(m3)).toBe(false)
        const m4 = machine(); m4.readings[0].value = 'x'.repeat(65)
        expect(ok(m4)).toBe(false)
        expect(ok(machine())).toBe(true)
    })

    it('caps readings at 200 and housekeeping at 10', () => {
        const reading = machine().readings[0]
        const hk = machine().housekeeping[0]
        expect(ok({ ...machine(), readings: Array(200).fill(reading) })).toBe(true)
        expect(ok({ ...machine(), readings: Array(201).fill(reading) })).toBe(false)
        expect(ok({ ...machine(), housekeeping: Array(10).fill(hk) })).toBe(true)
        expect(ok({ ...machine(), housekeeping: Array(11).fill(hk) })).toBe(false)
    })
})
