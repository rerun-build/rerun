import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { factorySnapshotSchema, type FactorySnapshot } from '@moldwright/contracts'
import { sceneFromSnapshot, resetRides } from './from-snapshot'
import { BOSS_ID, STATUS_COLOR } from './factory-scene'

const SAMPLE = path.resolve(import.meta.dirname, '../../../../packages/contracts/fixtures/factory-snapshot.sample.json')
const T = Date.parse('2026-11-14T03:40:00Z')
const run = { id: BOSS_ID, name: 'Boss', runId: 'run-b1', startedAt: '2026-11-15T02:00:00Z', steps: 3 }
const snap = (filed: number | null, parent = 449): FactorySnapshot => factorySnapshotSchema.parse({
    ...JSON.parse(readFileSync(SAMPLE, 'utf8')), ...(filed === null ? {} : { planning: [{ parent, title: 'Cut', coworkers: [run], children: 6, filed }] }),
})
const rides = (s: FactorySnapshot, now: number) => sceneFromSnapshot(s, now).pods.filter(p => p.path[0].startsWith('plan-'))
const belt = (s: FactorySnapshot, now: number) => sceneFromSnapshot(s, now).links.find(l => l.source === 'plan-449')

beforeEach(() => resetRides())

describe('a filed child rides to the Loader once', () => {
    it('sends nothing for the filed count the page first sees, however often it draws it', () => {
        for (let i = 0; i < 6; i++) expect(rides(snap(2), T + i * 250)).toEqual([])
    })

    it('sends one sphere per newly filed child, staggered, with the path from the desk to the Loader', () => {
        rides(snap(2), T)
        const now = T + 10_000
        expect(rides(snap(4), now)).toHaveLength(1)
        expect(rides(snap(4), now)[0]).toMatchObject({ id: 'plan-ride-449-3', issue: 449, title: 'filed for #449', path: ['plan-449', 'Delegator'], state: 'working', band: 'build', level: 0, travel: 0, since: now })
        expect(rides(snap(4), now + 600).map(p => p.id)).toEqual(['plan-ride-449-3', 'plan-ride-449-4'])
        expect(rides(snap(4), now + 1_000)[0].travel).toBeGreaterThan(0)
    })

    it('ends each ride after 1.8 s and never repeats it for the same count', () => {
        rides(snap(2), T)
        rides(snap(3), T + 1_000)
        expect(rides(snap(3), T + 2_700)).toHaveLength(1)
        expect(rides(snap(3), T + 2_800)).toEqual([])
        expect(rides(snap(3), T + 3_000)).toEqual([])
        expect(rides(snap(3), T + 60_000)).toEqual([])
    })

    it('moves the belt only while a sphere rides it', () => {
        rides(snap(0), T)
        expect(belt(snap(0), T + 500)).toMatchObject({ still: true })
        rides(snap(1), T + 1_000)
        expect(belt(snap(1), T + 1_500)).toMatchObject({ still: false, color: STATUS_COLOR.build })
        expect(belt(snap(1), T + 3_000)).toMatchObject({ still: true })
    })

    it('takes the first count seen for a parent as its baseline, and a lower count as a new pass', () => {
        rides(snap(null), T)
        expect(rides(snap(1), T + 1_000)).toEqual([])
        expect(rides(snap(2), T + 2_000).map(p => p.id)).toEqual(['plan-ride-449-2'])
        expect(rides(snap(0), T + 5_000)).toEqual([])
        expect(rides(snap(1), T + 6_000).map(p => p.id)).toEqual(['plan-ride-449-1'])
    })

    it('draws no sphere for a parent that has no desk', () => {
        rides(snap(0, 449), T)
        const both = factorySnapshotSchema.parse({ ...snap(0, 449), planning: [snap(2, 449).planning![0], { ...snap(1, 452).planning![0] }] })
        expect(sceneFromSnapshot(both, T + 1_000).pods.filter(p => p.path[0].startsWith('plan-'))).toEqual([])
    })
})
