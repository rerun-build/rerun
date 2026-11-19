import { describe, expect, it } from 'vitest'
import { TILE_H, routeTileLinks } from '@moldwright/ui/iso-grid'

import { atDistance, centreOf, inScanner, lineUp, podPath, restDistances, settles, sphereShapes, tileShapes, toWorld, workSpot } from './factory-rest'
import { LOOP_MS, factoryScene } from './factory-scene'

const box = (shape: { x: number; y: number }[]) => ({ x0: Math.min(...shape.map(p => p.x)), x1: Math.max(...shape.map(p => p.x)), y0: Math.min(...shape.map(p => p.y)), y1: Math.max(...shape.map(p => p.y)) })

describe('where a sphere being worked rests', () => {
    it('keeps every resting sphere and its tag clear of every tile and of each other, across the sample loop', () => {
        for (let t = 0; t < LOOP_MS; t += 500) {
            const frame = factoryScene(t, 0)
            const routes = routeTileLinks(frame.tiles, frame.links)
            const rests = restDistances(frame.pods, frame.tiles, routes)
            const byId = new Map(frame.tiles.map(x => [x.id, x]))
            const placed = frame.pods.filter(settles).flatMap(p => {
                const pts = podPath(p.path, byId, routes)
                return pts.length < 2 ? [] : [{ id: p.id, shapes: sphereShapes(atDistance(pts, rests.get(p.id)!), inScanner(p)) }]
            })
            const clash: string[] = []
            for (const s of placed) {
                for (const tile of frame.tiles) {
                    if (s.shapes.some(a => tileShapes(tile).some(b => {
                        const p = box(a), q = box(b)
                        return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1 && overlapsExactly(a, b)
                    }))) clash.push(`${s.id} on ${tile.id}`)
                }
                for (const o of placed) if (o.id > s.id && s.shapes.some(a => o.shapes.some(b => overlapsExactly(a, b)))) clash.push(`${s.id} on ${o.id}`)
            }
            expect({ t, clash }).toEqual({ t, clash: [] })
        }
    })

    it('rests in front of its worker, short of the end of its line, when nothing is in the way', () => {
        const frame = factoryScene(9_000, 0)
        const routes = routeTileLinks(frame.tiles, frame.links)
        const rests = restDistances(frame.pods, frame.tiles, routes)
        const byId = new Map(frame.tiles.map(x => [x.id, x]))
        const working = frame.pods.filter(settles)
        expect(working.length).toBeGreaterThan(0)
        for (const p of working) {
            const pts = podPath(p.path, byId, routes)
            expect(rests.get(p.id)!).toBeLessThan(pts.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0))
        }
    })
})

describe('the fixed work spot and the line-up', () => {
    it('puts the spot straight in front of the holder, the same every time', () => {
        const tile = factoryScene(9_000, 0).tiles.find(x => x.id === 'code')!
        const c = toWorld(centreOf(tile))
        expect(c).toEqual({ x: 392, y: 294 })
        expect(workSpot(tile, false)).toEqual({ x: 392, y: 362 })
        expect(workSpot(tile, false).y).toBe(c.y + TILE_H + 40)
        expect(workSpot(tile, true).y - workSpot(tile, false).y).toBe(26)
        for (const t of [0, 20_000, 60_000]) {
            const again = factoryScene(t, 0).tiles.find(x => x.id === 'code')!
            expect(workSpot(again, false)).toEqual(workSpot(tile, false))
        }
    })

    it('never sits on its own holder', () => {
        let n = 0
        for (let t = 0; t <= LOOP_MS; t += 250) {
            const frame = factoryScene(t, 0)
            const byId = new Map(frame.tiles.map(x => [x.id, x]))
            for (const p of frame.pods) {
                if (!settles(p) || p.travel < 1) continue
                const holder = byId.get(p.path[p.path.length - 1])
                if (!holder) continue
                n++
                const spot = sphereShapes(workSpot(holder, inScanner(p)), inScanner(p))
                const clash = spot.some(a => tileShapes(holder).some(b => overlapsExactly(a, b)))
                expect({ t, id: p.id, clash }).toEqual({ t, id: p.id, clash: false })
            }
        }
        expect(n).toBe(648)
    })

    it('lines up evenly from the start of the belt', () => {
        const path = [{ x: 0, y: 0 }, { x: 400, y: 0 }]
        expect([0, 1, 2].map(i => lineUp(path, i))).toEqual([{ x: 22, y: 0 }, { x: 62, y: 0 }, { x: 102, y: 0 }])
    })
})

function overlapsExactly(a: { x: number; y: number }[], b: { x: number; y: number }[]) {
    for (const shape of [a, b]) {
        for (let i = 0; i < shape.length; i++) {
            const p = shape[i], q = shape[(i + 1) % shape.length]
            const n = { x: q.y - p.y, y: p.x - q.x }
            const pa = a.map(v => v.x * n.x + v.y * n.y), pb = b.map(v => v.x * n.x + v.y * n.y)
            if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false
        }
    }
    return true
}
