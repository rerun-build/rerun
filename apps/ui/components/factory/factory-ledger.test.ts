import { describe, expect, it } from 'vitest'
import type { FactoryJob, FactorySnapshot } from '@rerun/contracts'
import { buildLedger, chainOf, chipCounts, filterLedger } from './factory-ledger'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const job = (issue: number, over: Partial<FactoryJob> = {}): FactoryJob => ({
    issue, title: `T${issue}`, state: 'waiting', enteredAt: new Date(NOW - 60_000).toISOString(), pr: null, round: null,
    coworker: null, copy: null, steps: null, tokensIn: null, tokensOut: null, parent: 1, dependsOn: [], reason: null, ...over,
})
const snap = (jobs: FactoryJob[], epics?: FactorySnapshot['epics']): FactorySnapshot => ({
    version: 1, madeAt: new Date(NOW).toISOString(), beat: 1, repo: 'o/r', jobs, epics, holds: [], pools: [],
    endedToday: { merged: 0, rejected: 0, blocked: 0, failed: 0, returned: 0 },
})
const EPIC1 = [{ issue: 1, title: 'Epic one', kind: 'feature' as const }]
const ledger = (jobs: FactoryJob[], epics: FactorySnapshot['epics'] = EPIC1) => buildLedger(snap(jobs, epics))
const layerIssues = (e: ReturnType<typeof ledger>[number]) => e.layers.map((l) => [l.n, l.tasks.map((t) => t.issue)])

describe('buildLedger', () => {
    it('puts the tasks that need nothing in layer 1 and the rest above the layers they need', () => {
        const chain = ledger([job(10), job(11, { dependsOn: [10] }), job(12, { dependsOn: [11] })])[0]
        expect(layerIssues(chain)).toEqual([[1, [10]], [2, [11]], [3, [12]]])
        const flat = ledger([job(20), job(21)])[0]
        expect(layerIssues(flat)).toEqual([[1, [20, 21]]])
        const diamond = ledger([job(30), job(31, { dependsOn: [30] }), job(32, { dependsOn: [31] }), job(33, { dependsOn: [30] }), job(34, { dependsOn: [32, 33] })])[0]
        expect(layerIssues(diamond)).toEqual([[1, [30]], [2, [31, 33]], [3, [32]], [4, [34]]])
    })

    it('counts a need outside the epic, or merged, as met', () => {
        const epics = [...EPIC1, { issue: 2, title: 'Two', kind: 'fix' as const }]
        const e = ledger([
            job(10, { parent: 2 }), job(11, { state: 'merged' }),
            job(12, { dependsOn: [10, 11, 999] }),
            job(13), job(14, { dependsOn: [13] }),
        ], epics)[0]
        const t = (n: number) => e.layers.flatMap((l) => l.tasks).find((x) => x.issue === n)!
        expect(t(12).needs).toEqual([])
        expect(e.layers[0].tasks.map((x) => x.issue)).toContain(12)
        expect(t(14).needs).toEqual([13])
    })

    it('shows a cycle as an error row and keeps its waiters out of the layers', () => {
        const e = ledger([job(10, { dependsOn: [11] }), job(11, { dependsOn: [10] }), job(12, { dependsOn: [10] }), job(13)])[0]
        expect(e.cycle?.issues).toEqual([10, 11])
        expect(e.cycle?.tasks.map((t) => t.issue)).toEqual([10, 11, 12])
        expect(layerIssues(e)).toEqual([[1, [13]]])
        expect(ledger([job(1)])[0].cycle).toBeNull()
    })

    it('finds the critical path: the longest chain of unmet needs, lowest issue on a tie', () => {
        const e = ledger([job(10), job(11, { dependsOn: [10] }), job(12, { dependsOn: [11] }), job(13, { dependsOn: [10] }), job(14, { dependsOn: [13] })])[0]
        expect(e.criticalPath).toEqual([10, 11, 12])
        const crit = e.layers.flatMap((l) => l.tasks).filter((t) => t.critical).map((t) => t.issue)
        expect(crit).toEqual([10, 11, 12])
        const merged = ledger([job(20, { state: 'merged' }), job(21, { dependsOn: [20] }), job(22, { dependsOn: [21] })])[0]
        expect(merged.criticalPath).toEqual([21, 22])
        const done = ledger([job(30, { state: 'merged' }), job(31, { state: 'merged' })])[0]
        expect(done.criticalPath).toEqual([])
    })

    it('groups jobs by parent, adds an epic missing from the snapshot, and puts parentless jobs under No epic last', () => {
        const epics = [{ issue: 5, title: 'Five', kind: 'fix' as const }, { issue: 1, title: 'One', kind: 'feature' as const }]
        const out = buildLedger(snap([job(10, { parent: 5 }), job(11, { parent: 1 }), job(12, { parent: 7 }), job(13, { parent: null })], epics))
        expect(out.map((e) => e.issue)).toEqual([1, 5, 7, null])
        expect(out[2]).toMatchObject({ title: '#7', kind: null })
        expect(out[3]).toMatchObject({ title: 'No epic', kind: null })
        expect(out[3].layers[0].tasks[0].issue).toBe(13)
        expect(buildLedger(snap([job(1)])).map((e) => e.issue)).toEqual([1])
        expect(buildLedger(snap([]))).toEqual([])
    })

    it('rolls progress up from the tasks', () => {
        const e = ledger([job(10, { state: 'merged' }), job(11), job(12, { state: 'merged' })])[0]
        expect(e.progress).toEqual({ merged: 2, total: 3 })
    })

    it('takes subtasks from runs, then checks and merge from history', () => {
        const at = (m: number) => new Date(NOW - m * 60_000).toISOString()
        const e = ledger([
            job(10, {
                steps: 7,
                runs: [
                    { stage: 'review', coworkerId: 'b', status: 'running', startedAt: at(5), endedAt: null, tokensIn: 3, tokensOut: 4, runId: 'r2' },
                    { stage: 'build', coworkerId: 'a', status: 'done', startedAt: at(20), endedAt: at(10), tokensIn: 100, tokensOut: 50, runId: 'r1' },
                ],
                history: [
                    { state: 'building', at: at(20), reason: null, runId: null },
                    { state: 'checks', at: at(4), reason: null, runId: null },
                    { state: 'merged', at: at(1), reason: null, runId: null },
                ],
            }),
            job(11),
        ])[0]
        const subs = e.layers[0].tasks.find((t) => t.issue === 10)!.subtasks
        expect(subs.map((s) => [s.stage, s.who, s.steps, s.tokens])).toEqual([
            ['build', 'a', null, 150], ['review', 'b', 7, 7], ['checks', null, null, 0], ['merge', null, null, 0],
        ])
        expect(subs[2]).toMatchObject({ status: 'done', startedAt: at(4), endedAt: null })
        expect(e.layers[0].tasks.find((t) => t.issue === 11)!.subtasks).toEqual([])
    })
})

describe('filterLedger', () => {
    const jobs = [
        job(10, { state: 'merged', enteredAt: new Date(NOW - 3600_000).toISOString() }),
        job(11, { state: 'building', dependsOn: [10], department: 'engine', departments: ['docs'] }),
        job(12, { state: 'failed', dependsOn: [11] }),
        job(13, { state: 'waiting', dependsOn: [11] }),
        job(14, { state: 'merged', parent: 2, enteredAt: '2026-11-01T10:00:00.000Z' }),
    ]
    const epics = [...EPIC1, { issue: 2, title: 'Two', kind: 'fix' as const }]
    const full = () => ledger(jobs, epics)
    const issues = (f: Parameters<typeof filterLedger>[1]) => filterLedger(full(), f, NOW).map((e) => [e.issue, e.layers.map((l) => [l.n, l.tasks.map((t) => t.issue)])])

    it('filters without flattening: Running, Waiting, Problems, Done today, This wave, one department', () => {
        expect(issues('running')).toEqual([[1, [[1, [11]]]]])
        expect(issues('waiting')).toEqual([[1, [[2, [13]]]]])
        expect(issues('problems')).toEqual([[1, [[2, [12]]]]])
        expect(issues('doneToday')).toEqual([[1, [[1, [10]]]]])
        expect(issues('wave')).toEqual([[1, [[1, [10, 11]]]]])
        expect(issues({ department: 'docs' })).toEqual([[1, [[1, [11]]]]])
        expect(issues({ department: 'engine' })).toEqual([[1, [[1, [11]]]]])
        expect(filterLedger(full(), null, NOW)).toEqual(full())
    })

    it('keeps the cycle row only when one of its tasks matches', () => {
        const c = ledger([job(10, { dependsOn: [11], state: 'blocked' }), job(11, { dependsOn: [10] })])
        expect(filterLedger(c, 'problems', NOW)[0].cycle?.tasks.map((t) => t.issue)).toEqual([10])
        expect(filterLedger(c, 'running', NOW)).toEqual([])
    })
})

describe('chipCounts and chainOf', () => {
    it('counts the chips', () => {
        const e = ledger([
            job(10, { state: 'building', department: 'engine', departments: ['docs'] }),
            job(11, { state: 'queued', department: 'docs' }),
            job(12, { state: 'blocked' }),
            job(13, { state: 'merged', enteredAt: new Date(NOW - 1000).toISOString() }),
        ])
        expect(chipCounts(e, NOW)).toEqual({ running: 1, waiting: 1, problems: 1, doneToday: 1, byDepartment: { engine: 1, docs: 2 } })
    })

    it('chainOf follows needs both ways and flags a stuck chain', () => {
        const e = ledger([job(10, { state: 'failed' }), job(11, { dependsOn: [10] }), job(12, { dependsOn: [11] }), job(13)])
        expect(chainOf(e, 11)).toEqual({ waitsOn: [10], waitedBy: [12], stuck: true })
        expect(chainOf(e, 12)).toEqual({ waitsOn: [10, 11], waitedBy: [], stuck: true })
        expect(chainOf(e, 13)).toEqual({ waitsOn: [], waitedBy: [], stuck: false })
    })
})
