import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { factoryJobStateSchema, factorySnapshotSchema, type FactorySnapshot } from '@rerun/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { type BuddyLook, buddyColor, buddyEyes, buddyMouth, TileBuddy } from '@rerun/ui/iso-grid'
import { sceneFromSnapshot } from './from-snapshot'
import { factoryScene } from './factory-scene'

const sampleTime = vi.hoisted(() => ({ t: 0 }))
vi.mock('./factory-scene', async importOriginal => {
    const actual = await importOriginal<typeof import('./factory-scene')>()
    return { ...actual, factoryScene: (_t: number, now: number) => actual.factoryScene(sampleTime.t, now) }
})

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

    it('puts the blocked job in blocked with its reason and draws no pod for it', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        expect(f.blocked).toEqual([{ issue: 334, reason: 'plan: worktree tool refused the branch' }])
        expect(pod(f, 334)).toBeUndefined()
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
        expect(g.cabinets[0]).toMatchObject({ issue: 320, title: '', tasks: [330, 335] })
        expect(g.cabinets[0].slots.find(x => x.issue === 335)?.state).toBe('merged')
        expect(g.tiles.some(t => t.id === 'cab-320')).toBe(true)
    })

    it('draws no pod for any ended job: merged, rejected, blocked, failed, returned', () => {
        for (const state of ['merged', 'rejected', 'blocked', 'failed', 'returned'] as const) {
            const s = sample()
            s.jobs = [{ ...s.jobs[0], state }]
            expect(pod(sceneFromSnapshot(s, NOW), 330), state).toBeUndefined()
        }
    })

    it('still lists a blocked job in blocked with its reason', () => {
        const s = sample()
        s.jobs = [{ ...s.jobs[0], state: 'blocked', reason: 'plan: wrong' }]
        expect(sceneFromSnapshot(s, NOW).blocked).toEqual([{ issue: 330, reason: 'plan: wrong' }])
    })

    it('prints the feature number once: the cabinet title is empty and the aria label has the number once', () => {
        const s = sample()
        s.jobs[0].parent = 320
        const g = sceneFromSnapshot(s, NOW)
        expect(g.cabinets[0].title).toBe('')
        const label = g.tiles.find(t => t.id === 'cab-320')?.ariaLabel ?? ''
        expect(label).toMatch(/^Feature #320: /)
        expect(label.match(/#320/g)).toHaveLength(1)
    })

    it('every state of the contracts enum is mapped', () => {
        for (const state of factoryJobStateSchema.options) {
            const s = sample()
            s.jobs = [{ ...s.jobs[0], state }]
            expect(() => sceneFromSnapshot(s, NOW), state).not.toThrow()
        }
    })
})

const COWORKERS = ['code', 'LARRY', 'LINUS', 'BRUCE', 'search', 'DIETER']
const nothingRunning = (): FactorySnapshot => {
    const s = sample()
    s.jobs = s.jobs.map(j => ({ ...j, state: 'merged' as const }))
    s.holds = []
    s.pools = s.pools.map(p => ({ ...p, coworkers: p.coworkers.map(c => ({ ...c, out: 0 })) }))
    return s
}
const look = (style: object) => { const { buddy: _b, label: _l, shape: _s, ...rest } = style as Record<string, unknown>; return rest }

describe('sceneFromSnapshot: live tiles', () => {
    it('gives every coworker and the loader the same neutral idle style when nothing runs, whatever the sample time', () => {
        for (const t of [0, 2_000, 5_000, 9_000, 14_000, 20_000, 31_000]) {
            sampleTime.t = t
            const f = sceneFromSnapshot(nothingRunning(), NOW)
            const ids = [...COWORKERS, 'Delegator']
            const styles = ids.map(id => look(f.tiles.find(x => x.id === id)!.style))
            for (const [i, st] of styles.entries()) {
                expect(st, `${ids[i]} at t=${t}`).toEqual(styles[0])
                expect(st).toMatchObject({ glow: 'var(--iso-tile-idle-glow)', color: 'var(--iso-tile-idle)', opacity: 1 })
            }
        }
        sampleTime.t = 0
    })

    it('shows the working look only for a coworker the pools say has a run out, and for the loader when jobs are queued or in checks', () => {
        sampleTime.t = 14_000
        const s = nothingRunning()
        s.pools = s.pools.map(p => ({ ...p, coworkers: p.coworkers.map(c => (c.name === 'LINUS' ? { ...c, out: 1 } : c)) }))
        const f = sceneFromSnapshot(s, NOW)
        const st = (id: string) => f.tiles.find(x => x.id === id)!.style
        expect(st('LINUS').glow).toBe('color-mix(in srgb, #00b862 60%, transparent)')
        expect(st('code').glow).toBe('var(--iso-tile-idle-glow)')
        expect(st('Delegator').glow).toBe('var(--iso-tile-idle-glow)')
        s.jobs[0].state = 'queued'
        expect(sceneFromSnapshot(s, NOW).tiles.find(x => x.id === 'Delegator')!.style.glow).toBe('rgba(245, 158, 11, 0.6)')
        sampleTime.t = 0
    })

    it('puts no results flag on the loader, merged jobs or not', () => {
        const f = sceneFromSnapshot(sample(), LATER)
        expect(sample().jobs.some(j => j.state === 'merged')).toBe(true)
        expect(f.tiles.find(x => x.id === 'Delegator')!.style.results).toBeUndefined()
    })

    it('draws the Loader as a capsule on the live floor, and no other tile', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        expect(f.held).toBe(true)
        expect(f.tiles.find(x => x.id === 'Delegator')!.style).toMatchObject({ shape: 'capsule', badge: 'lock' })
        expect(f.tiles.filter(x => x.id !== 'Delegator' && x.style.shape)).toEqual([])
    })

    it('draws the Loader as a capsule in the sample loop at any time', () => {
        for (const t of [0, 6_000, 25_000, 50_000]) {
            const tiles = factoryScene(t, 0).tiles
            expect(tiles.find(x => x.id === 'Delegator')!.style.shape).toBe('capsule')
            expect(tiles.filter(x => x.id !== 'Delegator' && x.style.shape)).toEqual([])
        }
    })

    it('renders no face on the Loader of the sample loop', () => {
        const tiles = factoryScene(6_000, 0).tiles
        const html = (id: string) => renderToStaticMarkup(createElement(TileBuddy, { id, style: tiles.find(x => x.id === id)!.style, width: 120, height: 120, floorOffset: 0 } as never))
        expect(html('Delegator')).toContain('data-capsule')
        expect(html('Delegator')).not.toContain('iso-buddy-eyes')
        expect(html('code')).toContain('iso-buddy-eyes')
    })

    it('draws a running copy in its coworker own colours, see-through, and the coworker itself solid', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        const copy = f.tiles.find(x => x.id === 'code-copy-330')!.style
        expect(copy.color).not.toBe('#f59e0b')
        expect(copy.color).toBe(f.tiles.find(x => x.id === 'code')!.style.color)
        expect(copy.opacity).toBeLessThan(1)
        expect(f.tiles.find(x => x.id === 'code')!.style.opacity).toBe(1)
    })
})

describe('belts ask for chevrons', () => {
    it('asks for chevrons on every belt of the live floor, and on no trace', () => {
        for (const now of [NOW, LATER]) {
            const links = sceneFromSnapshot(sample(), now).links
            const belts = links.filter(l => l.variant === 'belt')
            expect(belts.length).toBeGreaterThan(0)
            expect(belts.every(l => l.chevrons === true)).toBe(true)
            const traces = links.filter(l => l.variant === 'trace')
            expect(traces.length).toBeGreaterThan(0)
            expect(traces.some(l => l.chevrons)).toBe(false)
        }
    })

    it('asks for chevrons on every belt of the sample loop', () => {
        for (const t of [0, 6_000, 50_000]) {
            const links = factoryScene(t, 0).links
            const belts = links.filter(l => l.variant === 'belt')
            expect(belts.length).toBeGreaterThan(0)
            expect(belts.every(l => l.chevrons === true)).toBe(true)
            expect(links.filter(l => l.variant === 'trace').some(l => l.chevrons)).toBe(false)
        }
    })
    const withLinus = () => {
        const s = nothingRunning()
        s.pools = s.pools.map(p => ({ ...p, coworkers: p.coworkers.map(c => (c.name === 'LINUS' ? { ...c, out: 1 } : c)) }))
        return s
    }
    const html = (style: object, extra: object = {}) => renderToStaticMarkup(createElement(TileBuddy, { id: 'x', style, width: 120, height: 120, floorOffset: 0, ...extra } as never))

    it("draws each coworker's look from its pool id, as Rerun's panel does", () => {
        const f = sceneFromSnapshot(sample(), NOW)
        for (const [name, id] of [['code', 'code-1'], ['LARRY', 'larry-1'], ['LINUS', 'linus-1'], ['BRUCE', 'bruce-1'], ['search', 'search-1'], ['DIETER', 'dieter-1']]) {
            const b = f.tiles.find(t => t.id === name)!.style.buddy as BuddyLook
            expect(b.color).toBe(buddyColor(id, {}))
            expect(b.eyes).toBe(buddyEyes(id, {}))
            expect(b.mouth).toBe(buddyMouth(id, {}))
        }
    })

    it('falls back to the tile name when the pool sends no id', () => {
        const s = sample()
        for (const p of s.pools) for (const c of p.coworkers) delete c.id
        expect((sceneFromSnapshot(s, NOW).tiles.find(t => t.id === 'code')!.style.buddy as BuddyLook).color).toBe(buddyColor('code', {}))
    })

    it('works in its own colour: mood working, own glow, no amber', () => {
        const f = sceneFromSnapshot(withLinus(), NOW)
        const st = (id: string) => f.tiles.find(t => t.id === id)!.style
        expect(st('LINUS').buddy).toMatchObject({ mood: 'working', ownColor: true, color: '#00b862' })
        expect(st('LINUS').glow).toBe('color-mix(in srgb, #00b862 60%, transparent)')
        expect(st('code').glow).toBe('var(--iso-tile-idle-glow)')
        expect((st('code').buddy as BuddyLook).mood).toBeUndefined()
    })

    it('bobs and stands taller at work, is still and flat at rest, and does not bob under reduced motion', () => {
        const f = sceneFromSnapshot(withLinus(), NOW)
        const st = (id: string) => f.tiles.find(t => t.id === id)!.style
        expect(html(st('LINUS'))).toContain('data-buddy-motion="bob"')
        expect(html(st('LINUS'))).toContain('data-buddy-stretched')
        const rest = html(st('code'))
        expect(rest).not.toContain('data-buddy-motion')
        expect(rest).not.toContain('data-buddy-stretched')
        expect(rest).toContain('iso-buddy-body')
        expect(html(st('LINUS'), { reducedMotion: true })).not.toContain('data-buddy-motion')
        expect(html(st('Delegator'))).not.toContain('data-buddy-stretched')
        expect(html(st('code'), { stretched: true })).toContain('data-buddy-stretched')
    })

    it('a copy wears its coworker look, stands taller and is see-through', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        const copy = f.tiles.find(t => t.id === 'code-copy-330')!
        expect(copy.style.buddy).toEqual({ ...(f.tiles.find(t => t.id === 'code')!.style.buddy as BuddyLook), mood: 'working', ownColor: true })
        expect(copy.style.opacity).toBeLessThan(1)
        expect(html(copy.style)).toContain('data-buddy-stretched')
        expect(f.tiles.find(t => t.id === 'code')!.style.opacity ?? 1).toBe(1)
    })
})
