// The owner's own arrangement of the factory floor: where each coworker and floor object was dragged
// to, kept in the browser per workspace. A copy is placed around its coworker when it appears, on the
// nearest free cells; it does not move with the coworker as a fixed shape.

import { containerContainsTile, type ContainerCells, type Tile } from '@rerun/ui/iso-grid'

import { COPY_CELLS, type Cell } from './factory-scene'

export type Moves = Record<string, Cell>

const OBJECTS = ['Delegator', 'code', 'LARRY', 'LINUS', 'BRUCE', 'search', 'DIETER', 'rejects']
const OWNERS = Object.keys(COPY_CELLS) as (keyof typeof COPY_CELLS)[]

export const isMovable = (id: string) => OBJECTS.includes(id) || id.startsWith('cab-')
// `code-copy-330` in the sample loop, `LINUS-copy-331` from the snapshot, `search-copy`.
const ownerOf = (id: string) => OWNERS.find(o => id.toLowerCase().startsWith(`${o.toLowerCase()}-copy`))

type Footprint = { id: string; col: number; row: number; span: number }
const overlap = (a: Footprint, b: Footprint) =>
    a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.span && b.row < a.row + a.span

const boxOf = (containers: ContainerCells[], p: Footprint) => containers.find(c => containerContainsTile(c, p, p.span))

const MAX_RING = 12
// The first free 2x2 around `owner`, ring after ring outward from ring 3 (one free cell beside the coworker) to 12; inside a ring by
// distance, then column offset, then row offset. `null` when none is free.
export function copyCells(owner: Cell, taken: Footprint[], containers?: ContainerCells[]): Cell | null {
    for (let r = 3; r <= MAX_RING; r++) {
        const ring: Cell[] = []
        for (let dc = -r; dc <= r; dc++) for (let dr = -r; dr <= r; dr++) if (Math.max(Math.abs(dc), Math.abs(dr)) === r) ring.push({ col: dc, row: dr })
        ring.sort((a, b) => a.col ** 2 + a.row ** 2 - (b.col ** 2 + b.row ** 2) || a.col - b.col || a.row - b.row)
        for (const d of ring) {
            const fp: Footprint = { id: 'copy', col: owner.col + d.col, row: owner.row + d.row, span: 2 }
            if (taken.some(t => overlap(fp, t))) continue
            if (containers && !boxOf(containers, fp)) continue
            return { col: fp.col, row: fp.row }
        }
    }
    return null
}

// `tiles` are the scene's, at their default places. Given the boxes, a moved object takes the box that
// holds it, and each copy takes the nearest free cells around its coworker, in scene order.
export function applyMoves(tiles: Tile[], moves: Moves, containers?: ContainerCells[]): Tile[] {
    const placed = tiles.map(t => {
        if (!isMovable(t.id)) return t
        const position = moves[t.id] ?? t.position
        const box = containers && moves[t.id] ? (boxOf(containers, { id: t.id, ...position, span: t.span ?? 2 }) as { id?: string } | undefined)?.id : undefined
        return { ...t, draggable: true, position, ...(box ? { containerId: box } : {}) }
    })
    const taken: Footprint[] = placed.filter(t => isMovable(t.id)).map(t => ({ id: t.id, ...t.position, span: t.span ?? 2 }))
    return placed.map(t => {
        const owner = ownerOf(t.id)
        const ownerTile = owner && placed.find(o => o.id === owner)
        if (!ownerTile) return t
        const cell = copyCells(ownerTile.position, taken, containers)
        if (!cell) return t
        taken.push({ id: t.id, ...cell, span: t.span ?? 2 })
        const box = containers && (boxOf(containers, { id: t.id, ...cell, span: t.span ?? 2 }) as { id?: string } | undefined)?.id
        return { ...t, position: cell, ...(box ? { containerId: box } : {}) }
    })
}

// Whether a whole arrangement holds: no two objects on one cell and, given the scene's boxes, every
// object inside one of them. Copies are placed when they appear and do not take part.
export function layoutFits(tiles: Tile[], moves: Moves, containers?: ContainerCells[]) {
    const placed: Footprint[] = applyMoves(tiles, moves)
        .filter(t => isMovable(t.id))
        .map(t => ({ id: t.id, ...t.position, span: t.span ?? 2 }))
    if (containers && !placed.every(p => boxOf(containers, p))) return false
    return placed.every((a, i) => placed.every((b, j) => j <= i || !overlap(a, b)))
}

// Why `id` may not stand at `cell`, the rest of the arrangement as it is; `null` when it may.
export function dropReason(tiles: Tile[], moves: Moves, id: string, cell: Cell, containers?: ContainerCells[]): string | null {
    const tile = tiles.find(t => t.id === id)
    if (!isMovable(id) || !tile) return 'this cannot be moved'
    const me: Footprint = { id, ...cell, span: tile.span ?? 2 }
    if (containers && !boxOf(containers, me)) return 'outside every box'
    const others = applyMoves(tiles, moves).filter(t => isMovable(t.id) && t.id !== id)
    if (others.some(t => overlap(me, { id: t.id, ...t.position, span: t.span ?? 2 }))) return 'another object is here'
    return null
}

// Whether `id` may stand at `cell`, the rest of the arrangement as it is.
export function canMove(tiles: Tile[], moves: Moves, id: string, cell: Cell, containers?: ContainerCells[]) {
    return dropReason(tiles, moves, id, cell, containers) === null
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
