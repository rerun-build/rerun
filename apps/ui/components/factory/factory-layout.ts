import { containerContainsTile, routeTileLinks, type AxisPoint, type ContainerCells, type Tile, type TileLink } from '@rerun/ui/iso-grid'

import { BAY, SEAT, type Cell } from './factory-scene'

export type Moves = Record<string, Cell>

const OBJECTS = ['Delegator', 'code', 'LARRY', 'LINUS', 'BRUCE', 'search', 'DIETER', 'rejects']
const OWNERS = ['code', 'LARRY', 'LINUS', 'BRUCE', 'search']

export const isMovable = (id: string) => OBJECTS.includes(id) || id.startsWith('cab-')
const isCopy = (id: string) => id.includes('-copy')
const ownerOf = (id: string, solid: Tile[]) => solid.find(o => id.toLowerCase().startsWith(`${o.id.toLowerCase()}-copy`))

type Footprint = { id: string; col: number; row: number; span: number }
const overlap = (a: Footprint, b: Footprint) =>
    a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.span && b.row < a.row + a.span

const boxOf = (containers: ContainerCells[], p: Footprint) => containers.find(c => containerContainsTile(c, p, p.span))

const key = (col: number, row: number) => `${col},${row}`
function cellsOf(points: AxisPoint[]): string[] {
    const out: string[] = []
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i]
        const n = Math.max(1, Math.ceil(Math.hypot(b.u - a.u, b.v - a.v) * 4))
        for (let s = 0; s <= n; s++) out.push(key(Math.floor(a.u + ((b.u - a.u) * s) / n), Math.floor(a.v + ((b.v - a.v) * s) / n)))
    }
    return out
}
export const beltCells = (tiles: Tile[], links: TileLink[]) =>
    new Set([...routeTileLinks(tiles, links.filter(l => l.variant === 'belt')).values()].flatMap(cellsOf))

const BELT_GAP = 2
const clearOf = (belts: Set<string>, c: Cell) => {
    for (let col = c.col - BELT_GAP; col < c.col + 2 + BELT_GAP; col++) for (let row = c.row - BELT_GAP; row < c.row + 2 + BELT_GAP; row++) if (belts.has(key(col, row))) return false
    return true
}
const JOB_REACH = 5
const inFront = (a: Cell, b: Cell) => {
    const dc = b.col - a.col, dr = b.row - a.row
    return dc + dr > 0 && Math.min(dc, dr) >= 0 && Math.max(dc, dr) <= JOB_REACH && Math.abs(dc - dr) <= 3
}
type Seat = { id: string; position: Cell; span: number }
type Floor = { taken: Footprint[]; solid: Footprint[]; belts: Set<string>; tiles: Seat[]; lines: TileLink[]; traces: TileLink[] }
const seatFree = (c: Cell, floor: Floor) =>
    clearOf(floor.belts, c) &&
    !floor.taken.some(t => overlap({ id: '', col: c.col - 1, row: c.row - 1, span: 4 }, t)) &&
    !floor.solid.some(t => inFront(c, t) || inFront(t, c))

const turn = (a: AxisPoint, b: AxisPoint, c: AxisPoint) => Math.sign((b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u))
const crosses = (p: AxisPoint[], q: AxisPoint[]) =>
    p.slice(1).some((b, i) => q.slice(1).some((d, j) => turn(p[i], b, q[j]) * turn(p[i], b, d) < 0 && turn(q[j], d, p[i]) * turn(q[j], d, b) < 0))
export function copyTree(tiles: { id: string; position: Cell }[], links: TileLink[]): TileLink[] {
    const at = new Map(tiles.map(t => [t.id, t.position]))
    const gap = (a: string, b: string) => Math.hypot(at.get(a)!.col - at.get(b)!.col, at.get(a)!.row - at.get(b)!.row)
    const own = links.filter(l => l.variant === 'trace' && isCopy(l.target) && at.has(l.source) && at.has(l.target))
    const tree = links.filter(l => !own.includes(l))
    for (const owner of new Set(own.map(l => l.source))) {
        const mine = own.filter(l => l.source === owner).sort((a, b) => gap(owner, a.target) - gap(owner, b.target) || (a.target < b.target ? -1 : 1))
        mine.forEach((l, i) => tree.push({ ...l, source: i === 0 ? owner : mine.slice(0, i).map(m => m.target).reduce((p, c) => (gap(c, l.target) < gap(p, l.target) ? c : p)) }))
    }
    return tree
}

export function treeRoutes(routes: Map<string, AxisPoint[]>, tree: TileLink[], links: TileLink[]) {
    const parent = new Map(tree.filter(l => l.variant === 'trace' && isCopy(l.target)).map(l => [l.target, l.source]))
    for (const l of links) {
        if (l.variant !== 'trace' || !isCopy(l.target) || parent.get(l.target) === l.source) continue
        const hops: string[] = [l.target]
        while (parent.has(hops[0]) && hops[0] !== l.source && hops.length <= parent.size) hops.unshift(parent.get(hops[0])!)
        if (hops[0] !== l.source) continue
        const points = hops.slice(1).flatMap((b, i) => routes.get(`${hops[i]}->${b}`) ?? [])
        routes.set(`${l.source}->${l.target}`, points)
        routes.set(`${l.target}->${l.source}`, [...points].reverse())
    }
    return routes
}

const seatsOf = (id: string, bay: Cell[]) => bay.map((position, i) => ({ id: `${id}-copy-${i}`, position, span: 2 }))
const tracesOf = (id: string, bay: Cell[]) => seatsOf(id, bay).map(s => ({ source: id, target: s.id, variant: 'trace' as const }))
function crossesBelt(owner: string, bay: Cell[], floor: Floor) {
    const tiles = [...floor.tiles, ...seatsOf(owner, bay)]
    const traces = copyTree(tiles, [...floor.traces, ...tracesOf(owner, bay)])
    const routes = routeTileLinks(tiles, [...floor.lines, ...traces])
    const belts = floor.lines.map(l => routes.get(`${l.source}->${l.target}`) ?? [])
    return traces.some(t => belts.some(b => crosses(routes.get(`${t.source}->${t.target}`) ?? [], b)))
}

function ring(r: number): Cell[] {
    const out: Cell[] = []
    for (let dc = -r; dc <= r; dc++) for (let dr = -r; dr <= r; dr++) if (Math.max(Math.abs(dc), Math.abs(dr)) === r) out.push({ col: dc, row: dr })
    return out.sort((a, b) => a.col ** 2 + a.row ** 2 - (b.col ** 2 + b.row ** 2) || a.col - b.col || a.row - b.row)
}

const MAX_RING = 16
const FLIPS = [[1, -1], [1, 1], [-1, -1], [-1, 1]]
const SHAPES = [BAY, BAY.map(b => ({ col: b.row, row: b.col }))]
const ROUTED_TRIES = 6
const corridorClear = (owner: Footprint, bay: Cell[], belts: Set<string>) => {
    const cols = bay.map(c => c.col), rows = bay.map(c => c.row)
    for (let col = Math.min(owner.col, ...cols); col < Math.max(owner.col + owner.span - 2, ...cols) + 2; col++)
        for (let row = Math.min(owner.row, ...rows); row < Math.max(owner.row + owner.span - 2, ...rows) + 2; row++)
            if (belts.has(key(col, row)) && (col < owner.col - 1 || col > owner.col + owner.span || row < owner.row - 1 || row > owner.row + owner.span)) return false
    return true
}
function placeBay(owner: Footprint, room: ContainerCells | undefined, floor: Floor): Cell[] | null {
    const fits: Cell[][] = []
    for (let r = SEAT; r <= MAX_RING; r++) for (const d of ring(r)) for (const shape of SHAPES) for (const [sx, sy] of FLIPS) {
        const bay = shape.map(b => ({ col: owner.col + d.col + sx * b.col, row: owner.row + d.row + sy * b.row }))
        if (!bay.every(c => (!room || containerContainsTile(room, c, 2)) && seatFree(c, floor))) continue
        if (corridorClear(owner, bay, floor.belts)) return bay
        fits.push(bay)
    }
    return fits.slice(0, ROUTED_TRIES).find(bay => !crossesBelt(owner.id, bay, floor)) ?? fits[0] ?? null
}
const reserve = (floor: Floor, id: string, bay: Cell[]) => {
    floor.taken.push(...bay.map(c => ({ id, ...c, span: 2 })))
    floor.solid.push(...bay.map(c => ({ id, ...c, span: 2 })))
    floor.tiles.push(...seatsOf(id, bay))
    floor.traces.push(...tracesOf(id, bay))
}

function copyCell(owner: Footprint, floor: Floor, containers?: ContainerCells[]): Cell | null {
    const room = containers && boxOf(containers, owner)
    for (let r = SEAT; r <= MAX_RING; r++) for (const d of ring(r)) {
        const c = { col: owner.col + d.col, row: owner.row + d.row }
        if ((!containers || (room && containerContainsTile(room, c, 2))) && seatFree(c, floor)) return c
    }
    return null
}

const MEMO_SIZE = 8
const memo = new Map<string, { belts: Set<string>; bays: Map<string, Cell[] | null> }>()
function ownersBays(solid: Tile[], footprints: Footprint[], lines: TileLink[], containers?: ContainerCells[]) {
    const id = JSON.stringify([footprints, lines.map(l => [l.source, l.target]), containers?.map(c => [c.col_start, c.row_start, c.col_end, c.row_end])])
    const hit = memo.get(id)
    if (hit) return hit
    const belts = lines.length ? beltCells(solid, lines) : new Set<string>()
    const seat = (order: Footprint[]) => {
        const floor: Floor = { taken: [...footprints], solid: [...footprints], belts, tiles: solid.map(t => ({ id: t.id, position: t.position, span: t.span ?? 2 })), lines, traces: [] }
        const bays = new Map<string, Cell[] | null>()
        for (const at of order) {
            const bay = placeBay(at, containers && boxOf(containers, at), floor)
            bays.set(at.id, bay)
            if (bay) reserve(floor, at.id, bay)
        }
        return bays
    }
    const lost = (bays: Map<string, Cell[] | null>) => [...bays.values()].filter(b => !b).length
    let order = footprints.filter(f => OWNERS.includes(f.id))
    let bays = seat(order)
    let best = bays
    for (let n = 0; n < order.length; n++) {
        const failed = order.find(o => !bays.get(o.id))
        if (!failed || failed === order[0]) break
        order = [failed, ...order.filter(o => o !== failed)]
        bays = seat(order)
        if (lost(bays) < lost(best)) best = bays
    }
    if (memo.size >= MEMO_SIZE) memo.clear()
    memo.set(id, { belts, bays: best })
    return memo.get(id)!
}

export function applyMoves(tiles: Tile[], moves: Moves, containers?: ContainerCells[], links: TileLink[] = []): Tile[] {
    const placed = tiles.map(t => {
        if (!isMovable(t.id)) return t
        const position = moves[t.id] ?? t.position
        const box = containers && moves[t.id] ? (boxOf(containers, { id: t.id, ...position, span: t.span ?? 2 }) as { id?: string } | undefined)?.id : undefined
        return { ...t, draggable: true, position, ...(box ? { containerId: box } : {}) }
    })
    const solid = placed.filter(t => !isCopy(t.id))
    const copies = placed.filter(t => isCopy(t.id))
    const footprints = solid.map(t => ({ id: t.id, ...t.position, span: t.span ?? 2 }))
    const lines = links.filter(l => l.variant === 'belt')
    const known = ownersBays(solid, footprints, lines, containers)
    const floor: Floor = { taken: [...footprints], solid: [...footprints], belts: known.belts, tiles: solid.map(t => ({ id: t.id, position: t.position, span: t.span ?? 2 })), lines, traces: [] }
    for (const [id, bay] of known.bays) if (bay) reserve(floor, id, bay)
    const seats = new Map<string, Cell>()
    const owners = [...new Set([...OWNERS, ...copies.map(c => ownerOf(c.id, solid)?.id ?? '')])]
    for (const id of owners) {
        const owner = solid.find(t => t.id === id)
        if (!owner) continue
        const mine = copies.filter(c => ownerOf(c.id, solid) === owner)
        if (!mine.length) continue
        const at: Footprint = { id, ...owner.position, span: owner.span ?? 2 }
        const bay = known.bays.has(id) ? known.bays.get(id)! : placeBay(at, containers && boxOf(containers, at), floor)
        if (!bay) {
            for (const c of mine) {
                const cell = copyCell(at, floor, containers)
                if (!cell) continue
                floor.taken.push({ id: c.id, ...cell, span: 2 })
                floor.solid.push({ id: c.id, ...cell, span: 2 })
                seats.set(c.id, cell)
            }
            continue
        }
        if (!known.bays.has(id)) reserve(floor, id, bay)
        const home = tiles.find(t => t.id === id)!.position
        const slotOf = (c: Tile) => BAY.findIndex(b => home.col + SEAT + b.col === c.position.col && home.row + b.row === c.position.row)
        const used = new Set<number>()
        for (const c of [...mine].sort((a, b) => Number(slotOf(a) < 0) - Number(slotOf(b) < 0))) {
            const slot = slotOf(c)
            const free = slot >= 0 && !used.has(slot) ? slot : BAY.findIndex((_, i) => !used.has(i))
            if (free < 0) continue
            used.add(free)
            seats.set(c.id, bay[free])
        }
    }
    return placed.filter(t => !isCopy(t.id) || seats.has(t.id)).map(t => {
        const cell = seats.get(t.id)
        if (!cell) return t
        const box = containers && (boxOf(containers, { id: t.id, ...cell, span: t.span ?? 2 }) as { id?: string } | undefined)?.id
        return { ...t, position: cell, ...(box ? { containerId: box } : {}) }
    })
}

export function layoutFits(tiles: Tile[], moves: Moves, containers?: ContainerCells[]) {
    const placed: Footprint[] = applyMoves(tiles, moves)
        .filter(t => isMovable(t.id))
        .map(t => ({ id: t.id, ...t.position, span: t.span ?? 2 }))
    if (containers && !placed.every(p => boxOf(containers, p))) return false
    return placed.every((a, i) => placed.every((b, j) => j <= i || !overlap(a, b)))
}

export function dropReason(tiles: Tile[], moves: Moves, id: string, cell: Cell, containers?: ContainerCells[]): string | null {
    const tile = tiles.find(t => t.id === id)
    if (!isMovable(id) || !tile) return 'this cannot be moved'
    const me: Footprint = { id, ...cell, span: tile.span ?? 2 }
    if (containers && !boxOf(containers, me)) return 'outside every box'
    const others = applyMoves(tiles, moves).filter(t => isMovable(t.id) && t.id !== id)
    if (others.some(t => overlap(me, { id: t.id, ...t.position, span: t.span ?? 2 }))) return 'another object is here'
    return null
}

export function canMove(tiles: Tile[], moves: Moves, id: string, cell: Cell, containers?: ContainerCells[]) {
    return dropReason(tiles, moves, id, cell, containers) === null
}

export function readMoves(raw: string | null, tiles: Tile[], containers?: ContainerCells[]): Moves {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw ?? '{}')
    } catch {
        return {}
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const here: Moves = {}
    const away: Moves = {}
    for (const [id, value] of Object.entries(parsed)) {
        const cell = value as Partial<Cell> | null
        if (!isMovable(id) || !cell || !Number.isSafeInteger(cell.col) || !Number.isSafeInteger(cell.row)) continue
        const at = { col: cell.col!, row: cell.row! }
        if (tiles.some(t => t.id === id)) here[id] = at
        else away[id] = at
    }
    return layoutFits(tiles, here, containers) ? { ...away, ...here } : away
}

export const layoutStorageKey = (workspace: string) => `rerun.factory-layout.${workspace}`

const listeners = new Set<() => void>()
export function subscribeLayout(listener: () => void) {
    listeners.add(listener)
    window.addEventListener('storage', listener)
    return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', listener)
    }
}
export function loadLayout(key: string) {
    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}
export function saveLayout(key: string, moves: Moves | null) {
    try {
        if (moves) window.localStorage.setItem(key, JSON.stringify(moves))
        else window.localStorage.removeItem(key)
    } catch {
        return
    }
    listeners.forEach(l => l())
}
