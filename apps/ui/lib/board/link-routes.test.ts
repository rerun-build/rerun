import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema } from '@rerun/contracts'
import { LINK_PITCH, TILE_H, TILE_W, routeTileLinks, type AxisPoint, type Tile, type TileLink } from '@rerun/ui/iso-grid'

import { LOOP_MS, factoryScene } from '@/components/factory/factory-scene'
import { sceneFromSnapshot } from '@/components/factory/from-snapshot'

const tile = (id: string, col: number, row: number, span = 2): Tile => ({ id, position: { col, row }, span, style: { color: '#fff' } })
const link = (source: string, target: string, variant: TileLink['variant'] = 'belt'): TileLink => ({ source, target, variant })

const HALF = 6.5 / ((TILE_W * TILE_H) / Math.hypot(TILE_W, TILE_H))
const EPS = 1e-6

type Seg = { key: string; axis: 0 | 1; c: number; lo: number; hi: number }
const segmentsOf = (key: string, points: AxisPoint[]): Seg[] =>
    points.slice(1).map((b, i) => {
        const a = points[i]
        return a.v === b.v
            ? { key, axis: 0, c: a.v, lo: Math.min(a.u, b.u), hi: Math.max(a.u, b.u) }
            : { key, axis: 1, c: a.u, lo: Math.min(a.v, b.v), hi: Math.max(a.v, b.v) }
    })

function findConflicts(tiles: Tile[], links: TileLink[]) {
    const routes = routeTileLinks(tiles, links)
    const seen = new Set<string>()
    const segs: Seg[] = []
    for (const l of links) {
        const pair = [l.source, l.target].sort().join('|')
        const points = routes.get(`${l.source}->${l.target}`)
        if (!points || seen.has(pair)) continue
        seen.add(pair)
        segs.push(...segmentsOf(pair, points))
    }
    const shared: string[] = []
    const crossings: string[] = []
    for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
            const a = segs[i], b = segs[j]
            if (a.key === b.key) continue
            if (a.axis === b.axis) {
                if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > EPS && Math.abs(a.c - b.c) < 2 * HALF - EPS) shared.push(`${a.key} / ${b.key}`)
            } else if (a.c > b.lo + EPS && a.c < b.hi - EPS && b.c > a.lo + EPS && b.c < a.hi - EPS) {
                crossings.push(`${a.key} x ${b.key}`)
            }
        }
    }
    const hits: string[] = []
    for (const s of segs) {
        for (const t of tiles) {
            const span = t.span ?? 2
            const [u0, u1, v0, v1] = s.axis === 0 ? [s.lo, s.hi, s.c - HALF, s.c + HALF] : [s.c - HALF, s.c + HALF, s.lo, s.hi]
            if (u0 < t.position.col + span - EPS && u1 > t.position.col + EPS && v0 < t.position.row + span - EPS && v1 > t.position.row + EPS) hits.push(`${s.key} over ${t.id}`)
        }
    }
    return { routes, shared, crossings, hits }
}

function sidewaysSteps(routes: Map<string, AxisPoint[]>) {
    const steps: string[] = []
    for (const [key, points] of routes) {
        const dir = (a: AxisPoint, b: AxisPoint) => `${Math.sign(b.u - a.u)},${Math.sign(b.v - a.v)}`
        for (let i = 1; i < points.length - 2; i++) {
            const length = Math.abs(points[i + 1].u - points[i].u) + Math.abs(points[i + 1].v - points[i].v)
            if (length < LINK_PITCH + EPS && dir(points[i - 1], points[i]) === dir(points[i + 1], points[i + 2])) steps.push(key)
        }
    }
    return steps
}

const portsOnPlusU = (routes: Map<string, AxisPoint[]>, id: string, targets: string[], plane: number) =>
    targets.map(t => {
        const [first, second] = routes.get(`${id}->${t}`)!
        expect(first.u).toBeCloseTo(plane)
        expect(second.v).toBeCloseTo(first.v) // leaves perpendicular to the face
        expect(second.u).toBeGreaterThan(first.u)
        return first.v
    })

describe('routeTileLinks', () => {
    it('sets a single end at the centre of the face that looks at the other end', () => {
        const routes = routeTileLinks([tile('a', 1, 1), tile('b', 7, 1)], [link('a', 'b')])
        const points = routes.get('a->b')!
        expect(points[0]).toEqual({ u: 3, v: 2 })
        expect(points[points.length - 1]).toEqual({ u: 7, v: 2 })
        expect(routes.get('b->a')).toEqual([...points].reverse())
    })

    it.each([
        { n: 1, offsets: [0] },
        { n: 2, offsets: [-LINK_PITCH / 2, LINK_PITCH / 2] },
        { n: 3, offsets: [-LINK_PITCH, 0, LINK_PITCH] },
    ])('spreads $n end(s) on a face symmetric about its centre', ({ n, offsets }) => {
        const rows = [0, 8, 4].slice(0, n).sort((a, b) => a - b)
        const targets = rows.map(r => tile(`t${r}`, 30, r + (n === 1 ? 4 : 0)))
        const routes = routeTileLinks([tile('hub', 1, 4), ...targets], targets.map(t => link('hub', t.id)))
        const ports = portsOnPlusU(routes, 'hub', targets.map(t => t.id), 3).sort((a, b) => a - b)
        offsets.forEach((o, i) => expect(ports[i]).toBeCloseTo(5 + o))
    })

    it('orders the ends by where they go, so they do not cross as they leave', () => {
        const targets = [tile('north', 30, -4), tile('mid', 30, 4), tile('south', 30, 12)]
        const routes = routeTileLinks([tile('hub', 1, 4), ...targets], targets.map(t => link('hub', t.id)))
        const [north, mid, south] = portsOnPlusU(routes, 'hub', ['north', 'mid', 'south'], 3)
        expect(north).toBeLessThan(mid)
        expect(mid).toBeLessThan(south)
    })

    it('shrinks the pitch so many ends stay inside the face, never past a corner', () => {
        const targets = [-12, -6, 0, 6, 12].map(r => tile(`t${r}`, 40, 4 + r))
        const routes = routeTileLinks([tile('hub', 1, 4), ...targets], targets.map(t => link('hub', t.id)))
        const ports = portsOnPlusU(routes, 'hub', targets.map(t => t.id), 3).sort((a, b) => a - b)
        expect(new Set(ports.map(p => p.toFixed(4))).size).toBe(5)
        expect(ports[0] - HALF).toBeGreaterThanOrEqual(4 - EPS)
        expect(ports[4] + HALF).toBeLessThanOrEqual(6 + EPS)
        expect((ports[0] + ports[4]) / 2).toBeCloseTo(5)
    })

    it('keeps a straight line in one lane from face to face, with no sideways step', () => {
        const tiles = [tile('hub', 1, 4), tile('ahead', 12, 4), tile('below', 12, 12)]
        const routes = routeTileLinks(tiles, [link('hub', 'ahead'), link('hub', 'below')])
        const straight = routes.get('hub->ahead')!
        expect(straight).toHaveLength(2)
        expect(straight[0].v).toBeCloseTo(straight[1].v)
        expect(straight[0].v).not.toBeCloseTo(5)
        expect(sidewaysSteps(routes)).toEqual([])
    })

    it('keeps an existing straight line straight when a new end joins its face', () => {
        const tiles = [tile('a', 1, 4), tile('b', 12, 4), tile('c', 12, 12)]
        const alone = routeTileLinks(tiles, [link('a', 'b')]).get('a->b')!
        const joined = routeTileLinks(tiles, [link('a', 'b'), link('a', 'c')]).get('a->b')!
        expect(alone).toHaveLength(2)
        expect(joined).toHaveLength(2)
        expect(Math.abs(joined[0].v - alone[0].v)).toBeCloseTo(LINK_PITCH / 2)
        expect(joined[1].v).toBeCloseTo(joined[0].v)
    })

    it('moves no line but by its port when a call starts or stops', () => {
        const tiles = [tile('a', 1, 1), tile('b', 13, 1), tile('c', 1, 13), tile('d', 13, 13), tile('e', 7, 22)]
        const cables = [link('a', 'b', 'cable'), link('a', 'c', 'cable'), link('b', 'd', 'cable'), link('c', 'e', 'cable')]
        const quiet = routeTileLinks(tiles, cables)
        const calls = [link('a', 'd', 'beam'), link('d', 'e', 'beam')]
        for (let n = 1; n <= calls.length; n++) {
            const busy = routeTileLinks(tiles, [...cables, ...calls.slice(0, n)])
            for (const c of cables) {
                const before = quiet.get(`${c.source}->${c.target}`)!
                const after = busy.get(`${c.source}->${c.target}`)!
                expect(after.length, `${c.source}->${c.target}`).toBe(before.length)
                after.forEach((p, i) => expect(Math.max(Math.abs(p.u - before[i].u), Math.abs(p.v - before[i].v)), `${c.source}->${c.target}`).toBeLessThanOrEqual(LINK_PITCH / 2 + EPS))
            }
        }
    })

    it('routes around a tile standing between the two ends', () => {
        const tiles = [tile('a', 1, 1), tile('b', 13, 1), tile('wall', 7, 1)]
        const { hits, routes } = findConflicts(tiles, [link('a', 'b')])
        expect(hits).toEqual([])
        expect(routes.get('a->b')!.length).toBeGreaterThan(2)
    })

    it('routes around an extra footprint that is not a tile', () => {
        const tiles = [tile('a', 1, 1), tile('b', 13, 1)]
        const routes = routeTileLinks(tiles, [link('a', 'b')], [{ col: 7, row: 1, span: 2 }])
        const { hits } = findConflicts([...tiles, tile('bin', 7, 1)], [link('a', 'b')])
        expect(hits).toEqual([])
        expect(routes.get('a->b')!.some(p => p.v !== 2)).toBe(true)
    })

    it('gives the same routes whatever the order of the links', () => {
        const tiles = [tile('a', 1, 1), tile('b', 9, 1), tile('c', 1, 9), tile('d', 9, 9)]
        const links = [link('a', 'b'), link('a', 'd'), link('c', 'a'), link('b', 'd', 'trace')]
        const one = routeTileLinks(tiles, links)
        const two = routeTileLinks([...tiles].reverse(), [...links].reverse())
        for (const key of one.keys()) expect(two.get(key)).toEqual(one.get(key))
    })

    it('lays out the factory sample with no shared stretch, no belt over an object, no crossing', () => {
        for (let t = 0; t < LOOP_MS; t += 1_500) {
            const frame = factoryScene(t, 0)
            const { shared, hits, crossings, routes } = findConflicts(frame.tiles, frame.links)
            expect({ t, shared, hits, crossings, steps: sidewaysSteps(routes) }).toEqual({ t, shared: [], hits: [], crossings: [], steps: [] })
            for (const l of frame.links) {
                const points = routes.get(`${l.source}->${l.target}`)!
                expect(points.length).toBeGreaterThanOrEqual(2)
            }
        }
    })

    it('lays out the live scene of the snapshot sample the same way', () => {
        const s = factorySnapshotSchema.parse(JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../../packages/contracts/fixtures/factory-snapshot.sample.json'), 'utf8')))
        s.jobs[0].parent = 320
        const frame = sceneFromSnapshot(s, Date.parse('2026-11-14T03:24:40Z'))
        const { shared, hits, crossings, routes } = findConflicts(frame.tiles, frame.links)
        expect({ shared, hits, crossings, steps: sidewaysSteps(routes) }).toEqual({ shared: [], hits: [], crossings: [], steps: [] })
    })

    it('keeps the reject bin a free cell away from every coworker and from every belt but its own', () => {
        for (let t = 0; t < LOOP_MS; t += 1_500) {
            const frame = factoryScene(t, 0)
            const bin = frame.tiles.find(x => x.id === 'rejects')!
            const near = (a: Tile) => a.position.col < bin.position.col + 3 && a.position.col + 2 > bin.position.col - 1 && a.position.row < bin.position.row + 3 && a.position.row + 2 > bin.position.row - 1
            expect(frame.tiles.filter(x => x.id !== 'rejects' && near(x)).map(x => x.id)).toEqual([])
            const { routes } = findConflicts(frame.tiles, frame.links)
            for (const l of frame.links) {
                if (l.target === 'rejects' || l.source === 'rejects') continue
                const close = routes.get(`${l.source}->${l.target}`)!.some((p, i, all) => {
                    if (i === 0) return false
                    const q = all[i - 1]
                    const [u0, u1, v0, v1] = [Math.min(p.u, q.u) - HALF, Math.max(p.u, q.u) + HALF, Math.min(p.v, q.v) - HALF, Math.max(p.v, q.v) + HALF]
                    return u0 < bin.position.col + 3 && u1 > bin.position.col - 1 && v0 < bin.position.row + 3 && v1 > bin.position.row - 1
                })
                expect(close, `${l.source}->${l.target}`).toBe(false)
            }
        }
    })
})
