// Where the factory's spheres sit, in the world's px as FactoryOverlay draws them. A sphere being
// worked rests on its line short of whoever works it, and walks back along the line until the sphere
// and its tag clear every tile as drawn and every other resting sphere, so no two of them, and no
// sphere and a block, ever sit on top of each other.

import { GRID_SIZE, TILE_H, TILE_W, isoPosition, type AxisPoint, type Tile } from '@rerun/ui/iso-grid'

import type { PodView } from './factory-scene'

export type P = { x: number; y: number }
type Shape = P[] // a convex polygon

// The world's own frame, as TileLinks draws it: a tile's centre on the grid's two axes, and a point of
// a route from routeTileLinks in px.
const CENTER = isoPosition(GRID_SIZE / 2, GRID_SIZE / 2)
export const centreOf = (t: Tile): AxisPoint => { const s = t.span ?? 2; return { u: t.position.col + s / 2, v: t.position.row + s / 2 } }
export const toWorld = (p: AxisPoint): P => ({ x: (p.u - p.v) * (TILE_W / 2) + TILE_W / 2 - CENTER.left, y: (p.u + p.v) * (TILE_H / 2) - CENTER.top })

export function along(points: P[], f: number): P {
    const lens = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
    let d = f * lens.reduce((a, b) => a + b, 0)
    for (let i = 0; i < lens.length; i++) {
        if (d <= lens[i] || i === lens.length - 1) {
            const k = lens[i] ? Math.min(1, d / lens[i]) : 1
            return { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k }
        }
        d -= lens[i]
    }
    return points[points.length - 1]
}
export const lengthOf = (points: P[]) => points.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)
export const atDistance = (points: P[], px: number): P => {
    const total = lengthOf(points)
    return along(points, total ? Math.min(1, px / total) : 0)
}

// A sphere's path over the tiles it passes, on the board's own routes. A leg ends on one face of a
// tile and the next leaves from another, so both points are kept: the sphere crosses the tile between
// them. A pair with no line (a blocked job parked at a coworker) goes straight from centre to centre.
export function podPath(ids: string[], byId: Map<string, Tile>, routes: Map<string, AxisPoint[]>): P[] {
    const pts: P[] = []
    for (let i = 1; i < ids.length; i++) {
        const a = byId.get(ids[i - 1]), b = byId.get(ids[i])
        if (!a || !b) continue
        pts.push(...(routes.get(`${a.id}->${b.id}`) ?? [centreOf(a), centreOf(b)]).map(toWorld))
    }
    return pts
}

export const settles = (p: PodView) => p.state === 'working' || p.state === 'checks' || p.state === 'fixing'
export const inScanner = (p: PodView) => p.state === 'working' && p.band === 'review' && p.travel >= 1

const REST_PX = 24 // how far short of the end of its line a sphere being worked rests at best
const STEP_PX = 4 // how far back it moves at a time when that place is taken
const BLOCK_UP = 30 // how high a coworker's block stands above its floor
const rect = (x0: number, y0: number, x1: number, y1: number): Shape => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]

// What a tile covers on screen: its floor diamond raised by its block, and for the reject bin and a
// feature sphere what stands on it, with its label (cf. RejectBin and FeatureOrb).
export function tileShapes(t: Tile): Shape[] {
    const { x, y } = toWorld(centreOf(t))
    const s = t.span ?? 2
    const hw = (s * TILE_W) / 2, hh = (s * TILE_H) / 2
    const block = [{ x: x - hw, y }, { x: x - hw, y: y - BLOCK_UP }, { x, y: y - hh - BLOCK_UP }, { x: x + hw, y: y - BLOCK_UP }, { x: x + hw, y }, { x, y: y + hh }]
    if (t.id === 'rejects') return [block, rect(x - 38, y - 46, x + 38, y + 20), rect(x - 30, y + 24, x + 30, y + 40)]
    if (t.id.startsWith('cab-')) return [block, rect(x - 32, y - 70, x + 32, y - 6), rect(x - 46, y - 4, x + 46, y + 22)]
    return [block]
}

// What a sphere resting at `at` covers: the glass and its tag, or the whole gate when a scanner holds it
// (cf. Orb and Scanner in FactoryOverlay).
export function sphereShapes(at: P, scanner: boolean): Shape[] {
    const { x, y } = at
    return scanner ? [rect(x - 31, y - 62, x + 31, y + 16)] : [rect(x - 17, y - 36, x + 17, y), rect(x - 23, y + 1, x + 23, y + 13)]
}

// Two convex polygons overlap unless an edge of one separates them (separating axis test).
function overlap(a: Shape, b: Shape) {
    for (const shape of [a, b]) {
        for (let i = 0; i < shape.length; i++) {
            const p = shape[i], q = shape[(i + 1) % shape.length]
            const n = { x: q.y - p.y, y: p.x - q.x }
            const project = (s: Shape) => s.map(v => v.x * n.x + v.y * n.y)
            const pa = project(a), pb = project(b)
            if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false
        }
    }
    return true
}
const hits = (shapes: Shape[], others: Shape[]) => shapes.some(s => others.some(o => overlap(s, o)))

// How far along its path each sphere being worked rests. Each takes the first place, walking back from
// its best one, where it covers no tile and no sphere placed before it; a sphere with no such place on
// its whole line keeps its best one.
export function restDistances(pods: PodView[], tiles: Tile[], routes: Map<string, AxisPoint[]>): Map<string, number> {
    const byId = new Map(tiles.map(t => [t.id, t]))
    const taken = tiles.flatMap(tileShapes)
    const out = new Map<string, number>()
    for (const p of pods) {
        if (!settles(p)) continue
        const pts = podPath(p.path, byId, routes)
        if (pts.length < 2) continue
        const best = Math.max(0, lengthOf(pts) - REST_PX)
        let chosen = best
        for (let d = best; d >= 0; d -= STEP_PX) {
            if (!hits(sphereShapes(atDistance(pts, d), inScanner(p)), taken)) { chosen = d; break }
        }
        out.set(p.id, chosen)
        taken.push(...sphereShapes(atDistance(pts, chosen), inScanner(p)))
    }
    return out
}
