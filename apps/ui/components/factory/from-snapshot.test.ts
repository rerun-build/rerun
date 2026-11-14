import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factoryJobStateSchema, factorySnapshotSchema, type FactorySnapshot } from '@rerun/contracts'
import { sceneFromSnapshot } from './from-snapshot'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const sample = (): FactorySnapshot => factorySnapshotSchema.parse(JSON.parse(readFileSync(SAMPLE, 'utf8')))
const NOW = Date.parse('2026-11-14T03:24:40Z') // ten seconds after the sample, inside its hold
const LATER = Date.parse('2026-11-14T03:40:00Z')
const pod = (f: ReturnType<typeof sceneFromSnapshot>, issue: number) => f.pods.find(p => p.issue === issue)

describe('sceneFromSnapshot', () => {
    it('draws one pod per job of the sample with the stage of its state', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        expect(pod(f, 330)).toMatchObject({ band: 'build', state: 'working', path: ['Delegator', 'code', 'code-copy-330'] })
        expect(pod(f, 331)).toMatchObject({ band: 'review', state: 'working' })
        expect(pod(f, 332)).toMatchObject({ state: 'held', path: ['Delegator', 'code'], travel: 0, level: 0 })
        expect(pod(f, 333)).toMatchObject({ band: 'build', state: 'fixing' })
        expect(pod(f, 335)).toBeUndefined() // merged, and counted
        expect(f.counts).toMatchObject({ queued: 1, building: 2, review: 1, checks: 0, merged: 1 })
    })

    it('puts the blocked job in blocked with its reason and keeps its pod where it is', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        expect(f.blocked).toEqual([{ issue: 334, reason: 'plan: worktree tool refused the branch' }])
        expect(pod(f, 334)).toMatchObject({ state: 'queued', path: ['Delegator', 'code'], travel: 0 })
    })

    it('holds sending while a hold runs: held, holdLeftMs, queued pods held', () => {
        const during = sceneFromSnapshot(sample(), NOW)
        expect(during.held).toBe(true)
        expect(during.holdLeftMs).toBe(Date.parse('2026-11-14T03:34:40Z') - NOW)
        expect(pod(during, 332)?.state).toBe('held')
        expect(during.links.filter(l => l.variant === 'belt').every(l => l.color === '#ef4444')).toBe(true)
        const after = sceneFromSnapshot(sample(), LATER)
        expect(after.held).toBe(false)
        expect(after.holdLeftMs).toBe(0)
        expect(pod(after, 332)?.state).toBe('queued')
    })

    it('marks failed and returned jobs cracked and rejected', () => {
        const s = sample()
        s.jobs[0].state = 'failed'
        s.jobs[1].state = 'returned'
        s.jobs[2].state = 'rejected'
        const f = sceneFromSnapshot(s, NOW)
        expect(f.cracked).toEqual([330, 331])
        expect(f.rejects).toBe(1)
        expect(pod(f, 330)).toBeUndefined()
    })

    it('says not answering when the picture is older than two beats', () => {
        const fresh = sceneFromSnapshot(sample(), Date.parse(sample().madeAt) + 59_000)
        expect(fresh.notAnswering).toBe(false)
        const stale = sceneFromSnapshot(sample(), Date.parse(sample().madeAt) + 61_000)
        expect(stale.notAnswering).toBe(true)
        expect(stale.lastBeatMs).toBe(61_000)
    })

    it('draws a copy tile for copy 2 and none for copy 1', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        expect(f.tiles.some(t => t.id === 'code-copy-330')).toBe(true)
        expect(f.tiles.some(t => t.id === 'code-copy-333')).toBe(false)
        expect(f.tiles.some(t => t.id === 'LINUS-copy-331')).toBe(false)
    })

    it('gives a job with no parent no feature sphere, and a parent its own', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        expect(f.cabinets).toEqual([])
        expect(f.tiles.some(t => t.id.startsWith('cab-'))).toBe(false)
        const s = sample()
        s.jobs[0].parent = 320
        s.jobs[5].parent = 320
        const g = sceneFromSnapshot(s, NOW)
        expect(g.cabinets).toHaveLength(1)
        expect(g.cabinets[0]).toMatchObject({ issue: 320, title: '#320', tasks: [330, 335] })
        expect(g.cabinets[0].slots.find(x => x.issue === 335)?.state).toBe('merged')
        expect(g.tiles.some(t => t.id === 'cab-320')).toBe(true)
    })

    it('every state of the contracts enum is mapped', () => {
        for (const state of factoryJobStateSchema.options) {
            const s = sample()
            s.jobs = [{ ...s.jobs[0], state }]
            expect(() => sceneFromSnapshot(s, NOW), state).not.toThrow()
        }
    })
})
