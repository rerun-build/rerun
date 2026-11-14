import { describe, expect, it } from 'vitest'
import { routeTileLinks } from '@rerun/ui/iso-grid'

import { atDistance, inScanner, podPath, restDistances, settles, sphereShapes, tileShapes } from './factory-rest'
import { LOOP_MS, factoryScene } from './factory-scene'

// Bounding boxes are enough to report a collision by name; the module itself tests the exact shapes.
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

// The same separating-axis test as the module, written out so the check does not lean on it.
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
