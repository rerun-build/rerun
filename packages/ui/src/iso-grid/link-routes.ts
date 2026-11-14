// Routes for every link of a board, laid out together so they can share the floor: each end sits on
// the face of its tile that looks at the other end, the ends of one face are spread side by side
// around its centre, every route leaves its face perpendicular, routes keep to separate lanes where
// they run in the same corridor, and no route passes over a tile or an extra footprint.
//
// Coordinates are the grid's two iso axes: u along "col", v along "row". A tile of span s anchored at
// (col,row) covers u in [col, col+s] and v in [row, row+s]; its faces are the four sides of that
// square. Routes are found on the integer lattice (shortest path with a cost for bends, shared
// stretches and crossings), then each straight stretch is moved off its lattice line onto its port
// or onto a free lane.

import { DEFAULT_SPAN, TILE_H, TILE_W, isPlaced } from './iso'
import type { Tile, TileLink } from './types'

export type AxisPoint = { u: number; v: number }
// A footprint the routes keep off, in grid cells like a tile's: anchor and span.
export type LinkFootprint = { col: number; row: number; span: number }

// Screen px between two parallel lines one axis unit apart.
const AXIS_PX = (TILE_W * TILE_H) / Math.hypot(TILE_W, TILE_H)
// A belt's band in world px: wide enough to carry the factory's spheres.
export const BELT_WIDTH = 13
// The spacing of ends on a face and of lanes in a corridor, in axis units: a belt's width and a gap.
export const LINK_PITCH = (BELT_WIDTH + 3) / AXIS_PX

// Inside the router every length is in half cells (S per cell): the lattice then has a line down the
// middle of a one-cell gap and through the face centre of a one-cell tile, which a whole-cell lattice
// misses on tight boards. Points are scaled back on the way out.
const S = 2
const PITCH = LINK_PITCH * S
const HALF = (BELT_WIDTH / 2 / AXIS_PX) * S

const BEND = 4
const SHARE = 0.02 // per lattice step: a long shared run must not outweigh the choice of face
const CROSS = 8
const NEAR = 0.3 // a step within two cells of a tile: lines keep to the middle of open floor
const NEAR_CELLS = 2 * S
const OFF_FACE = 6 // an end on the face beside the one looking at the other end
const AWAY_FACE = 12 // an end on a face turned away from it
const CLEAR = 1 // lattice lines closer than half a cell to a tile are closed
// A pair is searched only in a window around its two tiles, so the cost follows the links and not the
// board's extent. Past these limits it falls back to the plain bend (plainPath).
const WINDOW = 6 * S // floor around the two tiles
const MAX_CELLS = 60_000 // the largest window searched, in lattice points
const MAX_STEPS = 30_000 // lattice states expanded per search
const LANES = [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2]

const RANK: Record<NonNullable<TileLink['variant']>, number> = { belt: 0, cable: 1, trace: 2, beam: 3 }

// Directions: 0 +u, 1 +v, 2 -u, 3 -v.
const DU = [1, 0, -1, 0]
const DV = [0, 1, 0, -1]

type Box = { u0: number; v0: number; u1: number; v1: number }
type End = { tile: string; box: Box; dir: number }
type Seg = { axis: 0 | 1; base: number; c: number; fixed: boolean }
type Route = { source: string; target: string; name: string; from: End; to: End; startRun: number; endRun: number; segs: Seg[]; lattice: AxisPoint[]; straight: boolean }

const boxOf = (col: number, row: number, span: number): Box => ({ u0: col, v0: row, u1: col + span, v1: row + span })
const overlaps = (a: Box, b: Box) => a.u0 < b.u1 && a.u1 > b.u0 && a.v0 < b.v1 && a.v1 > b.v0

// A face: its plane on the normal axis, and its centre and span along the face.
function face(b: Box, dir: number) {
    return dir % 2 === 0
        ? { plane: dir === 0 ? b.u1 : b.u0, centre: (b.v0 + b.v1) / 2, lo: b.v0, hi: b.v1 }
        : { plane: dir === 1 ? b.v1 : b.v0, centre: (b.u0 + b.u1) / 2, lo: b.u0, hi: b.u1 }
}
// The point at `normal` on the face's normal axis and `along` on the other one.
const onFace = (dir: number, normal: number, along: number): AxisPoint => (dir % 2 === 0 ? { u: normal, v: along } : { u: along, v: normal })

// How well a face looks at the other end, as a cost: the face toward the larger gap is free.
function faceCost(dir: number, du: number, dv: number) {
    const toward = dir % 2 === 0 ? du * DU[dir] : dv * DV[dir]
    if (toward <= 0) return AWAY_FACE
    return toward >= (dir % 2 === 0 ? Math.abs(dv) : Math.abs(du)) ? 0 : OFF_FACE
}

// A small binary heap of [priority, state].
class Heap {
    private items: [number, number][] = []
    get size() { return this.items.length }
    push(item: [number, number]) {
        const a = this.items
        a.push(item)
        for (let i = a.length - 1; i > 0; ) {
            const p = (i - 1) >> 1
            if (a[p][0] <= a[i][0]) break
            ;[a[p], a[i]] = [a[i], a[p]]
            i = p
        }
    }
    pop(): [number, number] {
        const a = this.items
        const top = a[0]
        const last = a.pop()!
        if (a.length) {
            a[0] = last
            for (let i = 0; ; ) {
                const l = 2 * i + 1, r = l + 1
                let m = i
                if (l < a.length && a[l][0] < a[m][0]) m = l
                if (r < a.length && a[r][0] < a[m][0]) m = r
                if (m === i) break
                ;[a[m], a[i]] = [a[i], a[m]]
                i = m
            }
        }
        return top
    }
}

// What the routes found so far have taken of the floor, kept sparse so nothing is sized to the board:
// per lattice point, bit 1/2 the edge to +u/+v carries a route, bit 4/8 a route runs through along u/v.
type Floor = { boxes: Box[]; taken: Map<number, number> }

// A lattice point as a number. Exact while |u| and |v| stay under 2^20, which every searched window
// does (a pair further out than that is never searched, cf. MAX_CELLS).
const OFFSET = 2 ** 20
const pointKey = (u: number, v: number) => (u + OFFSET) * 2 ** 21 + (v + OFFSET)
const takenAt = (floor: Floor, u: number, v: number) => floor.taken.get(pointKey(u, v)) ?? 0
// The point and bit holding the edge from (u,v) in direction `d`.
const edgeAt = (u: number, v: number, d: number): [number, number, number] =>
    d === 0 ? [u, v, 1] : d === 1 ? [u, v, 2] : d === 2 ? [u - 1, v, 1] : [u, v - 1, 2]

function closed(boxes: Box[], a: AxisPoint, b: AxisPoint, skip?: Box) {
    const r = { u0: Math.min(a.u, b.u) - CLEAR, u1: Math.max(a.u, b.u) + CLEAR, v0: Math.min(a.v, b.v) - CLEAR, v1: Math.max(a.v, b.v) + CLEAR }
    return boxes.some(box => box !== skip && overlaps(r, box))
}

// The lattice tip of a face: one unit out from its centre.
function tipOf(box: Box, dir: number): AxisPoint {
    const f = face(box, dir)
    return onFace(dir, Math.round(f.plane) + (dir < 2 ? 1 : -1), Math.round(f.centre))
}

type Found = { from: number; to: number; path: AxisPoint[]; searched: boolean }

// The cheapest lattice path from a face of `a` to a face of `b`, as points from face to face, searched
// in a window around the two tiles. Null when the window is too large, the target cannot be reached
// inside it, or the search runs past its step budget.
function search(floor: Floor, a: Box, b: Box): Found | null {
    const minU = Math.floor(Math.min(a.u0, b.u0)) - WINDOW
    const minV = Math.floor(Math.min(a.v0, b.v0)) - WINDOW
    const w = Math.ceil(Math.max(a.u1, b.u1)) + WINDOW - minU + 1
    const h = Math.ceil(Math.max(a.v1, b.v1)) + WINDOW - minV + 1
    if (w * h > MAX_CELLS || Math.abs(minU) + w >= OFFSET || Math.abs(minV) + h >= OFFSET) return null
    const reach = NEAR_CELLS + 1
    const boxes = floor.boxes.filter(box => box.u1 > minU - reach && box.u0 < minU + w + reach && box.v1 > minV - reach && box.v0 < minV + h + reach)
    // Per window point: bit 1/2 the edge to +u/+v is closed by a tile; `near` within two cells of one.
    const shut = new Uint8Array(w * h)
    const near = new Uint8Array(w * h)
    for (const box of boxes) {
        for (let u = Math.max(minU, Math.floor(box.u0) - NEAR_CELLS); u <= Math.min(minU + w - 1, Math.ceil(box.u1) + NEAR_CELLS); u++) {
            for (let v = Math.max(minV, Math.floor(box.v0) - NEAR_CELLS); v <= Math.min(minV + h - 1, Math.ceil(box.v1) + NEAR_CELLS); v++) {
                const i = (u - minU) * h + (v - minV)
                near[i] = 1
                if (closed([box], { u, v }, { u: u + 1, v })) shut[i] |= 1
                if (closed([box], { u, v }, { u, v: v + 1 })) shut[i] |= 2
            }
        }
    }
    const du = (b.u0 + b.u1 - a.u0 - a.u1) / 2
    const dv = (b.v0 + b.v1 - a.v0 - a.v1) / 2
    const inside = (p: AxisPoint) => p.u >= minU && p.v >= minV && p.u < minU + w && p.v < minV + h
    const id = (p: AxisPoint, d: number) => ((p.u - minU) * h + (p.v - minV)) * 4 + d
    const stubOpen = (box: Box, dir: number) => {
        const f = face(box, dir)
        return !closed(boxes, onFace(dir, f.plane, Math.round(f.centre)), tipOf(box, dir), box)
    }

    const goals = [0, 1, 2, 3]
        .filter(d => stubOpen(b, d))
        .map(d => ({ dir: d, tip: tipOf(b, d), inward: (d + 2) % 4, cost: 1 + faceCost(d, -du, -dv) }))
        .filter(g => inside(g.tip))
    if (!goals.length) return null
    const heuristic = (p: AxisPoint) => {
        let best = Infinity
        for (const g of goals) best = Math.min(best, Math.abs(g.tip.u - p.u) + Math.abs(g.tip.v - p.v))
        return best
    }

    const size = w * h * 4
    const cost = new Float64Array(size).fill(Infinity)
    const prev = new Int32Array(size).fill(-1)
    const startDir = new Int8Array(size).fill(-1)
    const done = new Uint8Array(size)
    const heap = new Heap()
    let steps = 0
    for (const d of [0, 1, 2, 3]) {
        const tip = tipOf(a, d)
        if (!inside(tip) || !stubOpen(a, d)) continue
        const s = id(tip, d)
        const g = 1 + faceCost(d, du, dv)
        if (g < cost[s]) {
            cost[s] = g
            startDir[s] = d
            heap.push([g + heuristic(tip), s])
        }
    }

    // A goal reached is pushed back as a virtual state -1 - (state * 4 + goal), so the cheapest
    // arrival, bend into the face included, is the one popped first.
    while (heap.size) {
        const [, s] = heap.pop()
        if (s < 0) {
            const code = -1 - s
            const last = Math.floor(code / 4)
            const goal = goals.find(g => g.dir === code % 4)!
            const states: number[] = []
            for (let x = last; x >= 0; x = prev[x]) states.push(x)
            states.reverse()
            const at = (x: number): AxisPoint => {
                const cell = Math.floor(x / 4)
                return { u: Math.floor(cell / h) + minU, v: (cell % h) + minV }
            }
            const first = states[0]
            const fa = face(a, startDir[first])
            const fb = face(b, goal.dir)
            return {
                from: startDir[first],
                to: goal.dir,
                path: [onFace(startDir[first], fa.plane, Math.round(fa.centre)), ...states.map(at), onFace(goal.dir, fb.plane, Math.round(fb.centre))],
                searched: true,
            }
        }
        if (done[s]) continue
        done[s] = 1
        if (++steps > MAX_STEPS) return null
        const g = cost[s]
        const cell = Math.floor(s / 4)
        const p = { u: Math.floor(cell / h) + minU, v: (cell % h) + minV }
        const dir = s % 4
        for (const goal of goals) {
            if (goal.tip.u === p.u && goal.tip.v === p.v) heap.push([g + goal.cost + (dir === goal.inward ? 0 : BEND), -1 - (s * 4 + goal.dir)])
        }
        for (const d of [0, 1, 2, 3]) {
            if (d === (dir + 2) % 4) continue
            const q = { u: p.u + DU[d], v: p.v + DV[d] }
            if (!inside(q)) continue
            const [eu, ev, bit] = edgeAt(p.u, p.v, d)
            if (shut[(eu - minU) * h + (ev - minV)] & bit) continue
            const qi = cell + DU[d] * h + DV[d]
            const crossed = takenAt(floor, q.u, q.v) & (d % 2 === 0 ? 8 : 4)
            const step = 1 + (d === dir ? 0 : BEND) + (takenAt(floor, eu, ev) & bit ? SHARE : 0) + (crossed ? CROSS : 0) + (near[qi] ? NEAR : 0)
            const t = id(q, d)
            if (g + step < cost[t]) {
                cost[t] = g + step
                prev[t] = s
                heap.push([g + step + heuristic(q), t])
            }
        }
    }
    return null
}

// The path's corners, from face point to face point.
function corners(path: AxisPoint[]) {
    return path.filter((p, i) => {
        if (i === 0 || i === path.length - 1) return true
        const a = path[i - 1], b = path[i + 1]
        return !((a.u === p.u && p.u === b.u) || (a.v === p.v && p.v === b.v))
    })
}

// Marks a searched path, one lattice step at a time, as taken.
function take(floor: Floor, path: AxisPoint[]) {
    const mark = (u: number, v: number, bits: number) => floor.taken.set(pointKey(u, v), takenAt(floor, u, v) | bits)
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i]
        const axis = a.v === b.v ? 0 : 1
        const [eu, ev, bit] = edgeAt(a.u, a.v, dirOf(a, b))
        mark(eu, ev, bit)
        mark(a.u, a.v, axis === 0 ? 4 : 8)
        mark(b.u, b.v, axis === 0 ? 4 : 8)
    }
}

// The plain bend between two tiles, from face centre to face centre, as the board drew it before
// routes were searched: the fallback for a pair too far apart, walled in, or too costly to search.
// Its points are its corners only. Null when the two tiles overlap.
function plainPath(a: Box, b: Box): Found | null {
    const ca = { u: Math.round((a.u0 + a.u1) / 2), v: Math.round((a.v0 + a.v1) / 2) }
    const cb = { u: Math.round((b.u0 + b.u1) / 2), v: Math.round((b.v0 + b.v1) / 2) }
    const ha = (a.u1 - a.u0) / 2, hb = (b.u1 - b.u0) / 2
    const du = cb.u - ca.u, dv = cb.v - ca.v
    const alongU = du >= 0 ? 0 : 2
    const alongV = dv >= 0 ? 1 : 3
    const at = (box: Box, dir: number) => { const f = face(box, dir); return onFace(dir, f.plane, Math.round(f.centre)) }
    const shape = (from: number, to: number, middle: AxisPoint[]): Found => ({ from, to, path: [at(a, from), ...middle, at(b, to)], searched: false })
    if (Math.abs(du) >= ha && Math.abs(dv) > hb) return shape(alongU, (alongV + 2) % 4, [{ u: cb.u, v: ca.v }])
    if (Math.abs(dv) >= ha && Math.abs(du) > hb) return shape(alongV, (alongU + 2) % 4, [{ u: ca.u, v: cb.v }])
    if (Math.abs(du) >= ha + hb) {
        const mid = Math.round((at(a, alongU).u + at(b, (alongU + 2) % 4).u) / 2)
        return shape(alongU, (alongU + 2) % 4, [{ u: mid, v: ca.v }, { u: mid, v: cb.v }])
    }
    if (Math.abs(dv) >= ha + hb) {
        const mid = Math.round((at(a, alongV).v + at(b, (alongV + 2) % 4).v) / 2)
        return shape(alongV, (alongV + 2) % 4, [{ u: ca.u, v: mid }, { u: cb.u, v: mid }])
    }
    return null
}

// The run of a segment along its own axis: from the line of the one before to the line of the next.
function extent(route: Route, i: number) {
    const a = i === 0 ? route.startRun : route.segs[i - 1].c
    const b = i === route.segs.length - 1 ? route.endRun : route.segs[i + 1].c
    return [Math.min(a, b), Math.max(a, b)] as const
}

const dirOf = (a: AxisPoint, b: AxisPoint) => (b.u > a.u ? 0 : b.v > a.v ? 1 : b.u < a.u ? 2 : 3)
// Which way `d` turns from heading `h`: +1 the way +u turns to +v, -1 the other way, 0 straight on.
const turn = (h: number, d: number) => DU[h] * DV[d] - DV[h] * DU[d]
const samePoint = (a: AxisPoint, b: AxisPoint) => a.u === b.u && a.v === b.v

// Which side of path `b` path `a` keeps to, both walked from one point with heading `h`: where they
// part, the one turning further toward +1 is on that side. Two links leaving one face, or running
// down one corridor, sit side by side in that order and never cross where they part.
function sideOf(a: AxisPoint[], b: AxisPoint[], h: number) {
    const ra = stretches(a), rb = stretches(b)
    let i = 0, j = 0, usedA = 0, usedB = 0
    while (i < ra.length && j < rb.length) {
        if (ra[i].dir !== rb[j].dir) return Math.sign(turn(h, ra[i].dir) - turn(h, rb[j].dir))
        h = ra[i].dir
        // Both walk on together as far as the shorter stretch goes.
        const step = Math.min(ra[i].length - usedA, rb[j].length - usedB)
        usedA += step
        usedB += step
        if (usedA >= ra[i].length) { i++; usedA = 0 }
        if (usedB >= rb[j].length) { j++; usedB = 0 }
    }
    return 0
}

// A path as its straight stretches, whether its points are unit steps or corners only.
function stretches(path: AxisPoint[]) {
    const out: { dir: number; length: number }[] = []
    for (let k = 1; k < path.length; k++) {
        const length = Math.abs(path[k].u - path[k - 1].u) + Math.abs(path[k].v - path[k - 1].v)
        if (!length) continue
        const dir = dirOf(path[k - 1], path[k])
        if (out.length && out[out.length - 1].dir === dir) out[out.length - 1].length += length
        else out.push({ dir, length })
    }
    return out
}

// A route's lattice path from point `p` on, walked so that its stretch on `axis` heads toward +.
function onwardFrom(route: Route, p: AxisPoint, forward: boolean) {
    const path = forward ? route.lattice : [...route.lattice].reverse()
    const on = (a: AxisPoint, b: AxisPoint) =>
        Math.min(a.u, b.u) <= p.u && p.u <= Math.max(a.u, b.u) && Math.min(a.v, b.v) <= p.v && p.v <= Math.max(a.v, b.v)
    for (let i = 1; i < path.length; i++) if (on(path[i - 1], path[i])) return [p, ...path.slice(samePoint(path[i], p) ? i + 1 : i)]
    return path
}

const byName = (a: Route, b: Route) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

// What routing reads of a tile and of a link.
export type RoutedTile = Pick<Tile, 'id' | 'position' | 'span'>
export type RoutedLink = Pick<TileLink, 'source' | 'target' | 'variant'>

export function routeTileLinks(tiles: RoutedTile[], links: RoutedLink[], obstacles: LinkFootprint[] = []): Map<string, AxisPoint[]> {
    const placed = new Map(tiles.filter(t => isPlaced(t.position)).map(t => [t.id, t]))
    const scaled = (col: number, row: number, span: number) => boxOf(col * S, row * S, span * S)
    const boxById = new Map([...placed.values()].map(t => [t.id, scaled(t.position.col, t.position.row, t.span ?? DEFAULT_SPAN)]))
    const boxes = [...[...boxById.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, b]) => b), ...obstacles.map(o => scaled(o.col, o.row, o.span))]

    // One route per pair of tiles, whatever the direction or variant: a beam lies on its cable, and
    // a sphere rides a belt either way.
    const pairs = new Map<string, { source: string; target: string; rank: number }>()
    const ordered = links
        .map(l => ({ source: l.source, target: l.target, rank: RANK[l.variant ?? 'beam'] }))
        .filter(l => l.source !== l.target && placed.has(l.source) && placed.has(l.target))
        .sort((a, b) => a.rank - b.rank || (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
    for (const l of ordered) {
        const key = l.source < l.target ? `${l.source}\n${l.target}` : `${l.target}\n${l.source}`
        if (!pairs.has(key)) pairs.set(key, l)
    }
    const out = new Map<string, AxisPoint[]>()
    if (!pairs.size) return out
    const floor: Floor = { boxes, taken: new Map() }

    // 1. Lattice paths, one link after the other: belts first, so the lines that stay take the floor.
    // A pair the search gives up on takes the plain bend; two overlapping tiles get a line between
    // their centres.
    const routes: Route[] = []
    for (const { source, target, rank } of pairs.values()) {
        const a = boxById.get(source)!, b = boxById.get(target)!
        const found = search(floor, a, b) ?? plainPath(a, b)
        if (!found) {
            const centre = (box: Box) => ({ u: (box.u0 + box.u1) / 2 / S, v: (box.v0 + box.v1) / 2 / S })
            out.set(`${source}->${target}`, [centre(a), centre(b)])
            out.set(`${target}->${source}`, [centre(b), centre(a)])
            continue
        }
        // A beam lives for one call: it leaves no mark, so one starting or stopping never moves another
        // line's path.
        if (found.searched && rank < RANK.beam) take(floor, found.path)
        const pts = corners(found.path)
        const from = { tile: source, box: a, dir: found.from }
        const to = { tile: target, box: b, dir: found.to }
        const segs: Seg[] = pts.slice(1).map((q, i) => {
            const axis = pts[i].v === q.v ? 0 : 1
            const base = axis === 0 ? q.v : q.u
            return { axis, base, c: base, fixed: false }
        })
        const startRun = face(a, from.dir).plane
        const endRun = face(b, to.dir).plane
        // A straight run gets a jog in its middle, kept only if its two ends cannot be lined up (step 2).
        const straight = segs.length === 1
        if (straight) {
            const s = segs[0]
            segs.splice(0, 1, { ...s }, { axis: s.axis === 0 ? 1 : 0, base: Math.round((startRun + endRun) / 2), c: Math.round((startRun + endRun) / 2), fixed: false }, { ...s })
        }
        routes.push({ source, target, name: `${source}\n${target}`, from, to, startRun, endRun, segs, lattice: found.path, straight })
    }

    // 2. Ports: the ends of one face, ordered by where they go, centred on it a pitch apart.
    const groups = new Map<string, { route: Route; atSource: boolean }[]>()
    for (const route of routes) {
        for (const atSource of [true, false]) {
            const end = atSource ? route.from : route.to
            const key = `${end.tile}\n${end.dir}`
            groups.set(key, [...(groups.get(key) ?? []), { route, atSource }])
        }
    }
    for (const ends of groups.values()) {
        const { box, dir } = ends[0].atSource ? ends[0].route.from : ends[0].route.to
        const f = face(box, dir)
        const n = ends.length
        const pitch = n > 1 ? Math.min(PITCH, (f.hi - f.lo - 2 * HALF) / (n - 1)) : 0
        // Along the face, coordinates grow toward the +1 side of the outward heading, or away from it.
        const along = turn(dir, dir % 2 === 0 ? 1 : 0)
        const path = (e: (typeof ends)[number]) => (e.atSource ? e.route.lattice : [...e.route.lattice].reverse())
        const sorted = [...ends].sort((x, y) => along * sideOf(path(x), path(y), dir) || byName(x.route, y.route) || Number(y.atSource) - Number(x.atSource))
        sorted.forEach((e, i) => {
            const seg = e.atSource ? e.route.segs[0] : e.route.segs[e.route.segs.length - 1]
            seg.c = f.centre + (i - (n - 1) / 2) * pitch
            seg.fixed = true
        })
    }

    // A straight line keeps one lane from face to face, never a sideways step mid-run. Its two ends are
    // lined up by moving the group of ends on one face as a whole: preferably the face with fewer ends,
    // else the other, else both half way, as long as every end stays inside its face. A lone end can
    // then sit off its face's centre. A face lined up once stays put, so a second straight line through
    // it keeps its jog.
    const endSeg = (e: { route: Route; atSource: boolean }) => (e.atSource ? e.route.segs[0] : e.route.segs[e.route.segs.length - 1])
    const keyOf = (end: End) => `${end.tile}\n${end.dir}`
    const anchored = new Set<string>()
    const shifted = (key: string, end: End, by: number) => {
        if (Math.abs(by) < 1e-9) return []
        if (anchored.has(key)) return null
        const f = face(end.box, end.dir)
        const moved = groups.get(key)!.map(e => endSeg(e).c + by)
        return Math.min(...moved) - HALF < f.lo - 1e-9 || Math.max(...moved) + HALF > f.hi + 1e-9 ? null : moved
    }
    for (const route of routes) {
        if (!route.straight) continue
        const head = route.segs[0], tail = route.segs[2]
        const gap = head.c - tail.c // how far the target's end must move to meet the source's
        if (Math.abs(gap) < 1e-9) continue
        const fromKey = keyOf(route.from), toKey = keyOf(route.to)
        const fewerAtTarget = groups.get(toKey)!.length <= groups.get(fromKey)!.length
        // [source group shift, target group shift]
        const options = fewerAtTarget ? [[0, gap], [-gap, 0], [-gap / 2, gap / 2]] : [[-gap, 0], [0, gap], [-gap / 2, gap / 2]]
        for (const [bySource, byTarget] of options) {
            const s = shifted(fromKey, route.from, bySource)
            const t = shifted(toKey, route.to, byTarget)
            if (!s || !t) continue
            if (s.length) groups.get(fromKey)!.forEach((e, i) => { endSeg(e).c = s[i] })
            if (t.length) groups.get(toKey)!.forEach((e, i) => { endSeg(e).c = t[i] })
            anchored.add(fromKey)
            anchored.add(toKey)
            break
        }
    }

    // 3. Lanes: the stretches sharing a lattice line run side by side in the order of where they
    // part, centred on the line, the whole group moved off it if a tile or another belt is in the way.
    const settled: { route: Route; i: number }[] = routes.flatMap(route => route.segs.map((s, i) => ({ route, i })).filter(x => x.route.segs[x.i].fixed))
    const clear = (route: Route, i: number) => {
        const seg = route.segs[i]
        const [lo, hi] = extent(route, i)
        const c = seg.c
        const band = seg.axis === 0 ? { u0: lo, u1: hi, v0: c - HALF, v1: c + HALF } : { u0: c - HALF, u1: c + HALF, v0: lo, v1: hi }
        // A stretch from a face starts on it: only the ones between two corners are held off the tiles.
        if (i > 0 && i < route.segs.length - 1 && hi - lo > 1e-9 && boxes.some(b => overlaps(band, b))) return false
        return settled.every(({ route: r, i: j }) => {
            const other = r.segs[j]
            if (r === route || other.axis !== seg.axis || Math.abs(other.c - c) >= PITCH - 1e-9) return true
            const [olo, ohi] = extent(r, j)
            return Math.min(hi, ohi) - Math.max(lo, olo) <= 1e-9
        })
    }
    // Moving a stretch also lengthens or shortens the two it joins, so those must stay clear too.
    const fits = (route: Route, i: number) => [i - 1, i, i + 1].every(k => k < 0 || k >= route.segs.length || clear(route, k))
    type Free = { route: Route; i: number; lo: number; hi: number; forward: boolean }
    const lines = new Map<string, Free[]>()
    routes.forEach(route => route.segs.forEach((seg, i) => {
        if (seg.fixed) return
        const a = i === 0 ? route.startRun : route.segs[i - 1].base
        const b = i === route.segs.length - 1 ? route.endRun : route.segs[i + 1].base
        const key = `${seg.axis}:${seg.base}`
        lines.set(key, [...(lines.get(key) ?? []), { route, i, lo: Math.min(a, b), hi: Math.max(a, b), forward: b > a }])
    }))
    const bundles: Free[][] = []
    for (const all of lines.values()) {
        // A jog has no length on the lattice: it shares no run, so it is placed on its own.
        const members = all.filter(m => m.hi - m.lo > 1e-9).sort((x, y) => x.lo - y.lo)
        bundles.push(...all.filter(m => m.hi - m.lo <= 1e-9).map(m => [m]))
        let group: Free[] = []
        let reach = -Infinity
        for (const m of members) {
            if (group.length && m.lo >= reach - 1e-9) { bundles.push(group); group = [] }
            group.push(m)
            reach = group.length === 1 ? m.hi : Math.max(reach, m.hi)
        }
        if (group.length) bundles.push(group)
    }
    const order = new Map(routes.map((r, k) => [r, k]))
    bundles.sort((x, y) => Math.min(...x.map(m => order.get(m.route)!)) - Math.min(...y.map(m => order.get(m.route)!)))
    for (const group of bundles) {
        const { axis, base } = group[0].route.segs[group[0].i]
        const heading = axis === 0 ? 0 : 1
        const side = turn(heading, axis === 0 ? 1 : 0)
        const from = (m: Free, start: number) => onwardFrom(m.route, axis === 0 ? { u: start, v: base } : { u: base, v: start }, m.forward)
        group.sort((x, y) => {
            const start = Math.max(x.lo, y.lo)
            return side * sideOf(from(x, start), from(y, start), heading) || byName(x.route, y.route)
        })
        const n = group.length
        const place = (shift: number) => group.forEach((m, k) => { m.route.segs[m.i].c = base + (k - (n - 1) / 2 + shift) * PITCH })
        const shift = LANES.find(s => { place(s); return group.every(m => fits(m.route, m.i)) }) ?? 0
        place(shift)
        settled.push(...group.map(m => ({ route: m.route, i: m.i })))
    }

    // 4. Points: the face point, a corner between each two stretches, the other face point.
    for (const route of routes) {
        const { segs } = route
        const at = (axis: 0 | 1, run: number, line: number): AxisPoint => (axis === 0 ? { u: run, v: line } : { u: line, v: run })
        const points = [at(segs[0].axis, route.startRun, segs[0].c)]
        for (let i = 0; i < segs.length - 1; i++) points.push(at(segs[i].axis, segs[i + 1].c, segs[i].c))
        const last = segs[segs.length - 1]
        points.push(at(last.axis, route.endRun, last.c))
        const clean = corners(points.filter((p, i) => i === 0 || Math.abs(p.u - points[i - 1].u) + Math.abs(p.v - points[i - 1].v) > 1e-9)).map(p => ({ u: p.u / S, v: p.v / S }))
        out.set(`${route.source}->${route.target}`, clean)
        out.set(`${route.target}->${route.source}`, [...clean].reverse())
    }
    return out
}
