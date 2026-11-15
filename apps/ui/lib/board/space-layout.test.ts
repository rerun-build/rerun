import { describe, expect, it } from 'vitest'
import { BOXES_PER_ROW, SPACE_SIZE, findFreeRect, findRadialRect, freeRectOnSide, rectOnSide, type SpaceRect } from './space-layout'

const rect = (colStart: number, rowStart: number, size = SPACE_SIZE): SpaceRect => ({
    col_start: colStart,
    row_start: rowStart,
    col_end: colStart + size - 1,
    row_end: rowStart + size - 1,
})

const overlaps = (a: SpaceRect, b: SpaceRect) => a.col_start <= b.col_end && b.col_start <= a.col_end && a.row_start <= b.row_end && b.row_start <= a.row_end

const asRect = (r: NonNullable<ReturnType<typeof freeRectOnSide>>): SpaceRect => ({ col_start: r.colStart, row_start: r.rowStart, col_end: r.colEnd, row_end: r.rowEnd })

describe('freeRectOnSide', () => {
    const source = rect(0, 0)

    it('lands adjacent on each side, aligned on the source and separated by one empty cell', () => {
        expect(freeRectOnSide(source, 'bottom-right', [source])).toEqual({ colStart: 9, rowStart: 0, colEnd: 16, rowEnd: 7 })
        expect(freeRectOnSide(source, 'top-left', [source])).toEqual({ colStart: -9, rowStart: 0, colEnd: -2, rowEnd: 7 })
        expect(freeRectOnSide(source, 'bottom-left', [source])).toEqual({ colStart: 0, rowStart: 9, colEnd: 7, rowEnd: 16 })
        expect(freeRectOnSide(source, 'top-right', [source])).toEqual({ colStart: 0, rowStart: -9, colEnd: 7, rowEnd: -2 })
    })

    it('centers the neighbour on the face rather than aligning it on the source corner', () => {
        const small = rect(0, 0, 4)
        expect(freeRectOnSide(small, 'bottom-right', [small])).toEqual({ colStart: 5, rowStart: -2, colEnd: 12, rowEnd: 5 })
        expect(freeRectOnSide(small, 'bottom-left', [small])).toEqual({ colStart: -2, rowStart: 5, colEnd: 5, rowEnd: 12 })
        expect(freeRectOnSide(small, 'top-right', [small])).toEqual({ colStart: -2, rowStart: -9, colEnd: 5, rowEnd: -2 })
        expect(freeRectOnSide(small, 'top-left', [small])).toEqual({ colStart: -9, rowStart: -2, colEnd: -2, rowEnd: 5 })
    })

    it('never overlaps an existing Box, whatever the side', () => {
        const spaces = [source]
        for (const side of ['bottom-right', 'top-left', 'bottom-left', 'top-right'] as const) {
            const free = freeRectOnSide(source, side, spaces)
            expect(free).not.toBeNull()
            spaces.push(asRect(free!))
        }
        for (let i = 0; i < spaces.length; i++) {
            for (let j = i + 1; j < spaces.length; j++) {
                expect(overlaps(spaces[i], spaces[j])).toBe(false)
            }
        }
    })

    it('gives up on the side when the adjacent slot is taken', () => {
        expect(freeRectOnSide(source, 'bottom-right', [source, rect(9, 0)])).toBeNull()
    })

    it('gives up when the neighbour would leave no gap, and keeps the side as soon as one fits', () => {
        expect(freeRectOnSide(source, 'bottom-right', [source, rect(17, 0)])).toBeNull()
        expect(freeRectOnSide(source, 'bottom-right', [source, rect(18, 0)])).toEqual({ colStart: 9, rowStart: 0, colEnd: 16, rowEnd: 7 })
    })

    it('leaves the other sides alone when one is blocked', () => {
        const spaces = [source, rect(9, 0)]
        expect(freeRectOnSide(source, 'bottom-right', spaces)).toBeNull()
        expect(freeRectOnSide(source, 'top-left', spaces)).not.toBeNull()
        expect(freeRectOnSide(source, 'top-right', spaces)).not.toBeNull()
        expect(freeRectOnSide(source, 'bottom-left', spaces)).not.toBeNull()
    })
})

describe('findFreeRect', () => {
    const fill = (count: number, start: SpaceRect[] = []) => {
        const spaces = [...start]
        for (let i = 0; i < count; i++) spaces.push(asRect(findFreeRect(spaces)))
        return spaces
    }

    it('lays six Boxes out as a grid, three per row', () => {
        expect(fill(6).map(s => [s.col_start, s.row_start])).toEqual([
            [0, 0],
            [9, 0],
            [18, 0],
            [0, 9],
            [9, 9],
            [18, 9],
        ])
    })

    it('never lets two of them touch or overlap', () => {
        const spaces = fill(7)
        for (let i = 0; i < spaces.length; i++) {
            for (let j = i + 1; j < spaces.length; j++) {
                expect(overlaps(spaces[i], spaces[j])).toBe(false)
            }
        }
    })

    it('fills the hole of an existing board before extending it', () => {
        expect(findFreeRect([rect(0, 0), rect(0, 9)])).toEqual({ colStart: 9, rowStart: 0, colEnd: 16, rowEnd: 7 })
    })

    it('follows a board that was dragged away from the origin', () => {
        expect(findFreeRect([rect(50, 50)])).toEqual({ colStart: 59, rowStart: 50, colEnd: 66, rowEnd: 57 })
    })

    it('keeps three columns whatever the count', () => {
        expect(new Set(fill(9).map(s => s.col_start)).size).toBe(BOXES_PER_ROW)
    })
})

describe('findRadialRect', () => {
    const grow = (count: number, start: SpaceRect[] = []) => {
        const spaces = [...start]
        for (let i = 0; i < count; i++) spaces.push(asRect(findRadialRect(spaces)))
        return spaces
    }

    it('lays the first Box alone, then one against each face of it', () => {
        expect(grow(5).map(s => [s.col_start, s.row_start])).toEqual([
            [0, 0],
            [0, -9],
            [9, 0],
            [0, 9],
            [-9, 0],
        ])
    })

    it('leaves the heart with no free face once its ring is closed', () => {
        const spaces = grow(5)
        for (const side of ['top-right', 'bottom-right', 'bottom-left', 'top-left'] as const) {
            expect(freeRectOnSide(spaces[0], side, spaces)).toBeNull()
        }
    })

    it('fills the corners of the first ring rather than walking away from the heart', () => {
        const spaces = grow(9)
        for (let i = 0; i < spaces.length; i++) {
            for (let j = i + 1; j < spaces.length; j++) {
                expect(overlaps(spaces[i], spaces[j])).toBe(false)
            }
        }
        for (const space of spaces) {
            expect(Math.max(Math.abs(space.col_start), Math.abs(space.row_start))).toBeLessThanOrEqual(9)
        }
    })

    it('follows a board that was dragged away from the origin', () => {
        expect(findRadialRect([rect(50, 50)])).toEqual({ colStart: 50, rowStart: 41, colEnd: 57, rowEnd: 48 })
    })

    it('falls back to the lattice when no face is free anywhere', () => {
        const wide = [rect(0, 0, 40), rect(0, -9), rect(41, 0), rect(0, 41), rect(-9, 0)]
        expect(() => findRadialRect(wide)).not.toThrow()
    })
})

describe('rectOnSide', () => {
    const source = rect(0, 0)

    it('falls back to stacking below when the side is blocked', () => {
        const spaces = [source, rect(9, 0)]
        expect(rectOnSide(source, 'bottom-right', spaces)).toEqual(findFreeRect(spaces))
    })
})
