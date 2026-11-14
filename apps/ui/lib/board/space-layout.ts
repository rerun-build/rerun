import { CONTAINER_SIDES, containerFaceCenter, type ContainerSide } from '@/lib/board/iso'

export const SPACE_SIZE = 8
export const SPACE_GAP = 1

export type SpaceSide = ContainerSide

export type SpaceRect = { col_start: number; row_start: number; col_end: number; row_end: number }
export type NewSpaceRect = { colStart: number; rowStart: number; colEnd: number; rowEnd: number }

export const BOXES_PER_ROW = 3

const SPACE_PITCH = SPACE_SIZE + SPACE_GAP

const MAX_SCANNED_ROWS = 64

function latticeAnchor(spaces: SpaceRect[]): { col: number; row: number } {
    if (!spaces.length) return { col: 0, row: 0 }
    return {
        col: Math.min(...spaces.map(s => Math.min(s.col_start, s.col_end))),
        row: Math.min(...spaces.map(s => Math.min(s.row_start, s.row_end))),
    }
}

function stackBelow(spaces: SpaceRect[]): NewSpaceRect {
    const lowestRow = spaces.reduce((max, s) => Math.max(max, s.row_start, s.row_end), -1)
    const rowStart = lowestRow + 1 + (spaces.length === 0 ? 0 : SPACE_GAP)
    return { colStart: 0, rowStart, colEnd: SPACE_SIZE - 1, rowEnd: rowStart + SPACE_SIZE - 1 }
}

export function findFreeRect(spaces: SpaceRect[]): NewSpaceRect {
    const anchor = latticeAnchor(spaces)

    for (let row = 0; row < MAX_SCANNED_ROWS; row++) {
        for (let col = 0; col < BOXES_PER_ROW; col++) {
            const colStart = anchor.col + col * SPACE_PITCH
            const rowStart = anchor.row + row * SPACE_PITCH
            const rect = { colStart, rowStart, colEnd: colStart + SPACE_SIZE - 1, rowEnd: rowStart + SPACE_SIZE - 1 }
            if (!spaces.some(other => collides(rect, other))) return rect
        }
    }

    return stackBelow(spaces)
}

function collides(a: NewSpaceRect, b: SpaceRect) {
    return a.colStart - SPACE_GAP <= Math.max(b.col_start, b.col_end) && Math.min(b.col_start, b.col_end) <= a.colEnd + SPACE_GAP && a.rowStart - SPACE_GAP <= Math.max(b.row_start, b.row_end) && Math.min(b.row_start, b.row_end) <= a.rowEnd + SPACE_GAP
}

const sameRect = (a: SpaceRect, b: SpaceRect) => a.col_start === b.col_start && a.col_end === b.col_end && a.row_start === b.row_start && a.row_end === b.row_end

export function freeRectOnSide(source: SpaceRect, side: SpaceSide, existing: SpaceRect[]): NewSpaceRect | null {
    const colStart = Math.min(source.col_start, source.col_end)
    const colEnd = Math.max(source.col_start, source.col_end)
    const rowStart = Math.min(source.row_start, source.row_end)
    const rowEnd = Math.max(source.row_start, source.row_end)

    const face = containerFaceCenter(source, side)
    const centered = (mid: number) => Math.round(mid) - SPACE_SIZE / 2

    const away = 1 + SPACE_GAP
    const rect = ((): NewSpaceRect => {
        switch (side) {
            case 'top-right': {
                const end = rowStart - away
                const start = centered(face.col)
                return { colStart: start, colEnd: start + SPACE_SIZE - 1, rowStart: end - (SPACE_SIZE - 1), rowEnd: end }
            }
            case 'bottom-left': {
                const start = rowEnd + away
                const col = centered(face.col)
                return { colStart: col, colEnd: col + SPACE_SIZE - 1, rowStart: start, rowEnd: start + SPACE_SIZE - 1 }
            }
            case 'bottom-right': {
                const start = colEnd + away
                const row = centered(face.row)
                return { colStart: start, colEnd: start + SPACE_SIZE - 1, rowStart: row, rowEnd: row + SPACE_SIZE - 1 }
            }
            case 'top-left': {
                const end = colStart - away
                const row = centered(face.row)
                return { colStart: end - (SPACE_SIZE - 1), colEnd: end, rowStart: row, rowEnd: row + SPACE_SIZE - 1 }
            }
        }
    })()

    return existing.some(other => !sameRect(other, source) && collides(rect, other)) ? null : rect
}

export function findRadialRect(spaces: SpaceRect[]): NewSpaceRect {
    const heart = spaces[0]
    if (!heart) return findFreeRect(spaces)

    const center = {
        col: (Math.min(heart.col_start, heart.col_end) + Math.max(heart.col_start, heart.col_end) + 1) / 2,
        row: (Math.min(heart.row_start, heart.row_end) + Math.max(heart.row_start, heart.row_end) + 1) / 2,
    }
    const distanceToHeart = (rect: NewSpaceRect) => ((rect.colStart + rect.colEnd + 1) / 2 - center.col) ** 2 + ((rect.rowStart + rect.rowEnd + 1) / 2 - center.row) ** 2

    let best: { rect: NewSpaceRect; distance: number } | null = null
    for (const source of spaces) {
        for (const side of CONTAINER_SIDES) {
            const rect = freeRectOnSide(source, side, spaces)
            if (!rect) continue
            const distance = distanceToHeart(rect)
            if (!best || distance < best.distance) best = { rect, distance }
        }
    }

    return best?.rect ?? findFreeRect(spaces)
}

export function rectOnSide(source: SpaceRect, side: SpaceSide, existing: SpaceRect[]): NewSpaceRect {
    return freeRectOnSide(source, side, existing) ?? findFreeRect(existing)
}
