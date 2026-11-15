import { DEFAULT_SPAN, TILE_H, TILE_W, isPlaced } from './iso'
import type { Tile, TileLink } from './types'

export type AxisPoint = { u: number; v: number }
export type LinkFootprint = { col: number; row: number; span: number }

const AXIS_PX = (TILE_W * TILE_H) / Math.hypot(TILE_W, TILE_H)
export const BELT_WIDTH = 13
export const LINK_PITCH = (BELT_WIDTH + 3) / AXIS_PX

const S = 2
const PITCH = LINK_PITCH * S
const HALF = (BELT_WIDTH / 2 / AXIS_PX) * S

const BEND = 4
const SHARE = 0.02
const CROSS = 8
const NEAR = 0.3
const NEAR_CELLS = 2 * S
const OFF_FACE = 6
const AWAY_FACE = 12
const CLEAR = 1
const WINDOW = 6 * S
const MAX_CELLS = 60_000
const MAX_STEPS = 30_000
const LANES = [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2]

const RANK: Record<NonNullable<TileLink['variant']>, number> = { belt: 0, cable: 1, trace: 2, beam: 3 }

const DU = [1, 0, -1, 0]
const DV = [0, 1, 0, -1]

type Box = { u0: number; v0: number; u1: number; v1: number }
type End = { tile: string; box: Box; dir: number }
type Seg = { axis: 0 | 1; base: number; c: number; fixed: boolean }
type Route = { source: string; target: string; name: string; from: End; to: End; startRun: number; endRun: number; segs: Seg[]; lattice: AxisPoint[]; straight: boolean }

const boxOf = (col: number, row: number, span: number): Box => ({ u0: col, v0: row, u1: col + span, v1: row + span })
const overlaps = (a: Box, b: Box) => a.u0 < b.u1 && a.u1 > b.u0 && a.v0 < b.v1 && a.v1 > b.v0

function face(b: Box, dir: number) {
    return dir % 2 === 0
        ? { plane: dir === 0 ? b.u1 : b.u0, centre: (b.v0 + b.v1) / 2, lo: b.v0, hi: b.v1 }
        : { plane: dir === 1 ? b.v1 : b.v0, centre: (b.u0 + b.u1) / 2, lo: b.u0, hi: b.u1 }
}
const onFace = (dir: number, normal: number, along: number): AxisPoint => (dir % 2 === 0 ? { u: normal, v: along } : { u: along, v: normal })

function faceCost(dir: number, du: number, dv: number) {
    const toward = dir % 2 === 0 ? du * DU[dir] : dv * DV[dir]
    if (toward <= 0) return AWAY_FACE
    return toward >= (dir % 2 === 0 ? Math.abs(dv) : Math.abs(du)) ? 0 : OFF_FACE
}

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

type Floor = { boxes: Box[]; taken: Map<number, number> }

const OFFSET = 2 ** 20
const pointKey = (u: number, v: number) => (u + OFFSET) * 2 ** 21 + (v + OFFSET)
const takenAt = (floor: Floor, u: number, v: number) => floor.taken.get(pointKey(u, v)) ?? 0
const edgeAt = (u: number, v: number, d: number): [number, number, number] =>
    d === 0 ? [u, v, 1] : d === 1 ? [u, v, 2] : d === 2 ? [u - 1, v, 1] : [u, v - 1, 2]

function closed(boxes: Box[], a: AxisPoint, b: AxisPoint, skip?: Box) {
    const r = { u0: Math.min(a.u, b.u) - CLEAR, u1: Math.max(a.u, b.u) + CLEAR, v0: Math.min(a.v, b.v) - CLEAR, v1: Math.max(a.v, b.v) + CLEAR }
    return boxes.some(box => box !== skip && overlaps(r, box))
}

function tipOf(box: Box, dir: number): AxisPoint {
    const f = face(box, dir)
    return onFace(dir, Math.round(f.plane) + (dir < 2 ? 1 : -1), Math.round(f.centre))
}

type Found = { from: number; to: number; path: AxisPoint[]; searched: boolean }

function search(floor: Floor, a: Box, b: Box): Found | null {
    const minU = Math.floor(Math.min(a.u0, b.u0)) - WINDOW
    const minV = Math.floor(Math.min(a.v0, b.v0)) - WINDOW
    const w = Math.ceil(Math.max(a.u1, b.u1)) + WINDOW - minU + 1
    const h = Math.ceil(Math.max(a.v1, b.v1)) + WINDOW - minV + 1
    if (w * h > MAX_CELLS || Math.abs(minU) + w >= OFFSET || Math.abs(minV) + h >= OFFSET) return null
    const reach = NEAR_CELLS + 1
    const boxes = floor.boxes.filter(box => box.u1 > minU - reach && box.u0 < minU + w + reach && box.v1 > minV - reach && box.v0 < minV + h + reach)
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

function corners(path: AxisPoint[]) {
    return path.filter((p, i) => {
        if (i === 0 || i === path.length - 1) return true
        const a = path[i - 1], b = path[i + 1]
        return !((a.u === p.u && p.u === b.u) || (a.v === p.v && p.v === b.v))
    })
}

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

function extent(route: Route, i: number) {
    const a = i === 0 ? route.startRun : route.segs[i - 1].c
    const b = i === route.segs.length - 1 ? route.endRun : route.segs[i + 1].c
    return [Math.min(a, b), Math.max(a, b)] as const
}

const dirOf = (a: AxisPoint, b: AxisPoint) => (b.u > a.u ? 0 : b.v > a.v ? 1 : b.u < a.u ? 2 : 3)
const turn = (h: number, d: number) => DU[h] * DV[d] - DV[h] * DU[d]
const samePoint = (a: AxisPoint, b: AxisPoint) => a.u === b.u && a.v === b.v

function sideOf(a: AxisPoint[], b: AxisPoint[], h: number) {
    const ra = stretches(a), rb = stretches(b)
    let i = 0, j = 0, usedA = 0, usedB = 0
    while (i < ra.length && j < rb.length) {
        if (ra[i].dir !== rb[j].dir) return Math.sign(turn(h, ra[i].dir) - turn(h, rb[j].dir))
        h = ra[i].dir
        const step = Math.min(ra[i].length - usedA, rb[j].length - usedB)
        usedA += step
        usedB += step
        if (usedA >= ra[i].length) { i++; usedA = 0 }
        if (usedB >= rb[j].length) { j++; usedB = 0 }
    }
    return 0
}

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

function onwardFrom(route: Route, p: AxisPoint, forward: boolean) {
    const path = forward ? route.lattice : [...route.lattice].reverse()
    const on = (a: AxisPoint, b: AxisPoint) =>
        Math.min(a.u, b.u) <= p.u && p.u <= Math.max(a.u, b.u) && Math.min(a.v, b.v) <= p.v && p.v <= Math.max(a.v, b.v)
    for (let i = 1; i < path.length; i++) if (on(path[i - 1], path[i])) return [p, ...path.slice(samePoint(path[i], p) ? i + 1 : i)]
    return path
}

const byName = (a: Route, b: Route) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

export type RoutedTile = Pick<Tile, 'id' | 'position' | 'span'>
export type RoutedLink = Pick<TileLink, 'source' | 'target' | 'variant'>

export function routeTileLinks(tiles: RoutedTile[], links: RoutedLink[], obstacles: LinkFootprint[] = []): Map<string, AxisPoint[]> {
    const placed = new Map(tiles.filter(t => isPlaced(t.position)).map(t => [t.id, t]))
    const scaled = (col: number, row: number, span: number) => boxOf(col * S, row * S, span * S)
    const boxById = new Map([...placed.values()].map(t => [t.id, scaled(t.position.col, t.position.row, t.span ?? DEFAULT_SPAN)]))
    const boxes = [...[...boxById.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, b]) => b), ...obstacles.map(o => scaled(o.col, o.row, o.span))]

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
        const straight = segs.length === 1
        if (straight) {
            const s = segs[0]
            segs.splice(0, 1, { ...s }, { axis: s.axis === 0 ? 1 : 0, base: Math.round((startRun + endRun) / 2), c: Math.round((startRun + endRun) / 2), fixed: false }, { ...s })
        }
        routes.push({ source, target, name: `${source}\n${target}`, from, to, startRun, endRun, segs, lattice: found.path, straight })
    }

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
        const along = turn(dir, dir % 2 === 0 ? 1 : 0)
        const path = (e: (typeof ends)[number]) => (e.atSource ? e.route.lattice : [...e.route.lattice].reverse())
        const sorted = [...ends].sort((x, y) => along * sideOf(path(x), path(y), dir) || byName(x.route, y.route) || Number(y.atSource) - Number(x.atSource))
        sorted.forEach((e, i) => {
            const seg = e.atSource ? e.route.segs[0] : e.route.segs[e.route.segs.length - 1]
            seg.c = f.centre + (i - (n - 1) / 2) * pitch
            seg.fixed = true
        })
    }

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
        const gap = head.c - tail.c
        if (Math.abs(gap) < 1e-9) continue
        const fromKey = keyOf(route.from), toKey = keyOf(route.to)
        const fewerAtTarget = groups.get(toKey)!.length <= groups.get(fromKey)!.length
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

    const settled: { route: Route; i: number }[] = routes.flatMap(route => route.segs.map((s, i) => ({ route, i })).filter(x => x.route.segs[x.i].fixed))
    const clear = (route: Route, i: number) => {
        const seg = route.segs[i]
        const [lo, hi] = extent(route, i)
        const c = seg.c
        const band = seg.axis === 0 ? { u0: lo, u1: hi, v0: c - HALF, v1: c + HALF } : { u0: c - HALF, u1: c + HALF, v0: lo, v1: hi }
        if (i > 0 && i < route.segs.length - 1 && hi - lo > 1e-9 && boxes.some(b => overlaps(band, b))) return false
        return settled.every(({ route: r, i: j }) => {
            const other = r.segs[j]
            if (r === route || other.axis !== seg.axis || Math.abs(other.c - c) >= PITCH - 1e-9) return true
            const [olo, ohi] = extent(r, j)
            return Math.min(hi, ohi) - Math.max(lo, olo) <= 1e-9
        })
    }
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
