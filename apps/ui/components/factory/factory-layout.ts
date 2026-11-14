// The owner's own arrangement of the factory floor: where each coworker and floor object was dragged
// to, kept in the browser per workspace. A copy moves with its coworker, keeping its place beside it.

import { containerContainsTile, type ContainerCells, type Tile } from '@rerun/ui/iso-grid'

import { COPY_CELLS, type Cell } from './factory-scene'

export type Moves = Record<string, Cell>

const OBJECTS = ['Delegator', 'code', 'LARRY', 'LINUS', 'BRUCE', 'search', 'DIETER', 'rejects']
const OWNERS = Object.keys(COPY_CELLS) as (keyof typeof COPY_CELLS)[]

export const isMovable = (id: string) => OBJECTS.includes(id) || id.startsWith('cab-')
// `code-copy-330` in the sample loop, `LINUS-copy-331` from the snapshot, `search-copy`.
const ownerOf = (id: string) => OWNERS.find(o => id.toLowerCase().startsWith(`${o.toLowerCase()}-copy`))

const shiftOf = (tiles: Tile[], moves: Moves, id: string): Cell => {
    const own = tiles.find(t => t.id === id)
    const to = moves[id]
    return own && to ? { col: to.col - own.position.col, row: to.row - own.position.row } : { col: 0, row: 0 }
}

// `tiles` are the scene's, at their default places.
export function applyMoves(tiles: Tile[], moves: Moves): Tile[] {
    return tiles.map(t => {
        if (isMovable(t.id)) return { ...t, draggable: true, position: moves[t.id] ?? t.position }
        const owner = ownerOf(t.id)
        if (!owner) return t
        const s = shiftOf(tiles, moves, owner)
        return { ...t, position: { col: t.position.col + s.col, row: t.position.row + s.row } }
    })
}

type Footprint = { id: string; col: number; row: number; span: number }
const overlap = (a: Footprint, b: Footprint) =>
    a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.span && b.row < a.row + a.span

// Whether a whole arrangement holds: no two objects on one cell, no object on a cell a copy takes when
// it comes, and, given the scene's boxes, every object and copy slot inside one of them.
export function layoutFits(tiles: Tile[], moves: Moves, containers?: ContainerCells[]) {
    const placed: Footprint[] = applyMoves(tiles, moves)
        .filter(t => isMovable(t.id))
        .map(t => ({ id: t.id, ...t.position, span: t.span ?? 2 }))
    for (const owner of OWNERS) {
        if (!tiles.some(t => t.id === owner)) continue
        const s = shiftOf(tiles, moves, owner)
        COPY_CELLS[owner].forEach((c, i) => placed.push({ id: `${owner}-copy#${i}`, col: c.col + s.col, row: c.row + s.row, span: 2 }))
    }
    if (containers && !placed.every(p => containers.some(c => containerContainsTile(c, p, p.span)))) return false
    return placed.every((a, i) => placed.every((b, j) => j <= i || !overlap(a, b)))
}

// Whether `id` may stand at `cell`, the rest of the arrangement as it is.
export function canMove(tiles: Tile[], moves: Moves, id: string, cell: Cell, containers?: ContainerCells[]) {
    return isMovable(id) && tiles.some(t => t.id === id) && layoutFits(tiles, { ...moves, [id]: cell }, containers)
}

// What the browser kept, if it still reads as a layout. Entries with odd values are left out. The
// arrangement is checked as a whole, as it was built drag by drag: if it no longer holds, the scene's
// objects go back to their default places. Objects not in the scene now (a feature sphere that comes
// and goes) keep their place for when they come back.
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

// The browser's storage as an external store for useSyncExternalStore: this tab's own writes notify
// it, another tab's arrive as `storage` events. Storage can refuse (private windows): the floor then
// keeps its default layout.
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
