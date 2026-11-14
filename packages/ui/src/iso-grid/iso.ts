export const GRID_SIZE = 12
export const TILE_W = 56
export const TILE_H = 28
export const DIAMOND = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'

export const BLOCK_HEIGHT = 7
export const BUDDY_HEIGHT_RATIO = 15 / 80

export const ISO_HALO_COLOR = 'var(--iso-halo, #fff)'

export const ISO_DIM_OPACITY = 0.1
export const ISO_DIM_MS = 300

export const DEFAULT_SPAN = 2
export const AGENT_SPAN = DEFAULT_SPAN

export const UNPLACED_COL = -100000
export function isPlaced(pos: { col: number }) {
    return pos.col > UNPLACED_COL
}

export function tileTopLift(style: { depth?: number; buddy?: BuddyFootprint }, span = DEFAULT_SPAN) {
    return style.buddy ? span * TILE_W * BUDDY_HEIGHT_RATIO * buddyFootprintShare(style) : style.depth ?? BLOCK_HEIGHT
}

type BuddyFootprint = true | { footprintShare?: number }

export const BUDDY_FOOTPRINT_SHARE = 0.8

export function buddyFootprintShare(style: { buddy?: BuddyFootprint }) {
    return (typeof style.buddy === 'object' ? style.buddy.footprintShare : undefined) ?? BUDDY_FOOTPRINT_SHARE
}

export function isoPosition(col: number, row: number) {
    return {
        left: (col - row) * (TILE_W / 2),
        top: (col + row) * (TILE_H / 2),
    }
}

export const TILE_Z_BASE = 10001

export function tileZ(col: number, row: number, span = 1, base = TILE_Z_BASE) {
    return Math.floor(col + row + 2 * (span - 1) + base)
}

export function tileCoversCell(col: number, row: number, c: number, r: number, span = DEFAULT_SPAN) {
    return c >= col && c < col + span && r >= row && r < row + span
}

export function tilesOverlap(a: { col: number; row: number }, b: { col: number; row: number }, spanA = DEFAULT_SPAN, spanB = DEFAULT_SPAN) {
    return a.col < b.col + spanB && b.col < a.col + spanA && a.row < b.row + spanB && b.row < a.row + spanA
}
export const agentsOverlap = (a: { col: number; row: number }, b: { col: number; row: number }) => tilesOverlap(a, b, DEFAULT_SPAN, DEFAULT_SPAN)

export function screenToGrid(screenX: number, screenY: number) {
    const col = Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2)
    const row = Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2)
    return { col, row }
}

export function hashUnit(input: string, salt: number) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return ((h >>> 0) % 10000) / 10000
}

export type ContainerSide = 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left'

export const CONTAINER_SIDES: readonly ContainerSide[] = ['top-right', 'bottom-right', 'bottom-left', 'top-left']

export type ContainerCells = { col_start: number; row_start: number; col_end: number; row_end: number }

export type ContainerHandle = 'top' | 'right' | 'bottom' | 'left'

export const MIN_CONTAINER_SPAN = DEFAULT_SPAN + 2

export function containerCellRange(rect: ContainerCells) {
    return {
        colMin: Math.min(rect.col_start, rect.col_end),
        colMax: Math.max(rect.col_start, rect.col_end),
        rowMin: Math.min(rect.row_start, rect.row_end),
        rowMax: Math.max(rect.row_start, rect.row_end),
    }
}

export function clampAnchorToRange(range: ReturnType<typeof containerCellRange>, span: number, anchor: { col: number; row: number }) {
    return {
        col: Math.max(range.colMin, Math.min(range.colMax - (span - 1), anchor.col)),
        row: Math.max(range.rowMin, Math.min(range.rowMax - (span - 1), anchor.row)),
    }
}

export function containerContainsTile(rect: ContainerCells, anchor: { col: number; row: number }, span: number) {
    const { colMin, colMax, rowMin, rowMax } = containerCellRange(rect)
    return anchor.col >= colMin && anchor.col + (span - 1) <= colMax && anchor.row >= rowMin && anchor.row + (span - 1) <= rowMax
}

export function resizedContainerRect(rect: ContainerCells, handle: ContainerHandle, cell: { col: number; row: number }, tiles: readonly { col: number; row: number; span: number }[]): ContainerCells {
    const { colMin, colMax, rowMin, rowMax } = containerCellRange(rect)
    let colStart = colMin
    let colEnd = colMax
    let rowStart = rowMin
    let rowEnd = rowMax

    switch (handle) {
        case 'top':
            colStart = cell.col
            rowStart = cell.row
            break
        case 'right':
            colEnd = cell.col
            rowStart = cell.row
            break
        case 'bottom':
            colEnd = cell.col
            rowEnd = cell.row
            break
        case 'left':
            colStart = cell.col
            rowEnd = cell.row
            break
    }

    if (tiles.length > 0) {
        colStart = Math.min(colStart, ...tiles.map(t => t.col))
        colEnd = Math.max(colEnd, ...tiles.map(t => t.col + (t.span - 1)))
        rowStart = Math.min(rowStart, ...tiles.map(t => t.row))
        rowEnd = Math.max(rowEnd, ...tiles.map(t => t.row + (t.span - 1)))
    }

    let low = { col: Math.min(colStart, colEnd), row: Math.min(rowStart, rowEnd) }
    let high = { col: Math.max(colStart, colEnd), row: Math.max(rowStart, rowEnd) }

    if (high.col - low.col < MIN_CONTAINER_SPAN - 1) {
        if (handle === 'top' || handle === 'left') low = { ...low, col: high.col - (MIN_CONTAINER_SPAN - 1) }
        else high = { ...high, col: low.col + (MIN_CONTAINER_SPAN - 1) }
    }
    if (high.row - low.row < MIN_CONTAINER_SPAN - 1) {
        if (handle === 'top' || handle === 'right') low = { ...low, row: high.row - (MIN_CONTAINER_SPAN - 1) }
        else high = { ...high, row: low.row + (MIN_CONTAINER_SPAN - 1) }
    }

    return { col_start: low.col, col_end: high.col, row_start: low.row, row_end: high.row }
}

export function containerDiamond(rect: ContainerCells, worldOffset: { left: number; top: number }) {
    const colStart = Math.min(rect.col_start, rect.col_end)
    const colEnd = Math.max(rect.col_start, rect.col_end)
    const rowStart = Math.min(rect.row_start, rect.row_end)
    const rowEnd = Math.max(rect.row_start, rect.row_end)

    const topCorner = isoPosition(colStart, rowStart)
    const rightCorner = isoPosition(colEnd + 1, rowStart)
    const bottomCorner = isoPosition(colEnd + 1, rowEnd + 1)
    const leftCorner = isoPosition(colStart, rowEnd + 1)

    const points = [topCorner, rightCorner, bottomCorner, leftCorner]
    const allLefts = points.map(p => p.left + TILE_W / 2)
    const allTops = points.map(p => p.top)

    const minLeft = Math.min(...allLefts)
    const maxLeft = Math.max(...allLefts)
    const minTop = Math.min(...allTops)
    const maxTop = Math.max(...allTops)

    const local = (p: { left: number; top: number }) => ({ x: p.left + TILE_W / 2 - minLeft, y: p.top - minTop })
    const corners = { top: local(topCorner), right: local(rightCorner), bottom: local(bottomCorner), left: local(leftCorner) }

    return {
        bounds: { left: minLeft + worldOffset.left, top: minTop + worldOffset.top, width: maxLeft - minLeft, height: maxTop - minTop },
        corners,
        path: `M ${corners.top.x},${corners.top.y} L ${corners.right.x},${corners.right.y} L ${corners.bottom.x},${corners.bottom.y} L ${corners.left.x},${corners.left.y} Z`,
    }
}

export function containerFaceCenter(rect: ContainerCells, side: ContainerSide) {
    const colStart = Math.min(rect.col_start, rect.col_end)
    const colEnd = Math.max(rect.col_start, rect.col_end)
    const rowStart = Math.min(rect.row_start, rect.row_end)
    const rowEnd = Math.max(rect.row_start, rect.row_end)

    const midCol = (colStart + colEnd + 1) / 2
    const midRow = (rowStart + rowEnd + 1) / 2

    switch (side) {
        case 'top-right':
            return { col: midCol, row: rowStart }
        case 'bottom-right':
            return { col: colEnd + 1, row: midRow }
        case 'bottom-left':
            return { col: midCol, row: rowEnd + 1 }
        case 'top-left':
            return { col: colStart, row: midRow }
    }
}
