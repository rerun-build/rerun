import { describe, expect, it } from 'vitest'
import { AGENT_SPAN, MIN_CONTAINER_SPAN, clampAnchorToRange, containerCellRange, containerContainsTile, resizedContainerRect, type ContainerCells } from '@moldwright/ui/iso-grid/iso'

const box = (colStart: number, rowStart: number, size: number): ContainerCells => ({
    col_start: colStart,
    row_start: rowStart,
    col_end: colStart + size - 1,
    row_end: rowStart + size - 1,
})

const tile = (col: number, row: number) => ({ col, row, span: AGENT_SPAN })

describe('containerContainsTile', () => {
    const space = box(0, 0, 8)

    it('accepts a footprint against every wall and in every corner', () => {
        for (const position of [
            { col: 0, row: 0 },
            { col: 6, row: 0 },
            { col: 0, row: 6 },
            { col: 6, row: 6 },
            { col: 0, row: 3 },
            { col: 3, row: 0 },
            { col: 6, row: 3 },
            { col: 3, row: 6 },
        ]) {
            expect(containerContainsTile(space, position, AGENT_SPAN)).toBe(true)
        }
    })

    it('refuses only footprints that overflow the rect', () => {
        expect(containerContainsTile(space, { col: -1, row: 3 }, AGENT_SPAN)).toBe(false)
        expect(containerContainsTile(space, { col: 7, row: 3 }, AGENT_SPAN)).toBe(false)
        expect(containerContainsTile(space, { col: 3, row: -1 }, AGENT_SPAN)).toBe(false)
        expect(containerContainsTile(space, { col: 3, row: 7 }, AGENT_SPAN)).toBe(false)
    })
})

describe('clampAnchorToRange', () => {
    it('clamps an overflowing footprint directly into a corner', () => {
        const range = containerCellRange(box(0, 0, 8))
        expect(clampAnchorToRange(range, AGENT_SPAN, { col: -5, row: -5 })).toEqual({ col: 0, row: 0 })
        expect(clampAnchorToRange(range, AGENT_SPAN, { col: 99, row: 99 })).toEqual({ col: 6, row: 6 })
    })
})

describe('resizedContainerRect', () => {
    it('stops directly at the tiles it holds, without padding', () => {
        expect(resizedContainerRect(box(0, 0, 8), 'top', { col: 6, row: 6 }, [tile(3, 3)])).toEqual({ col_start: 3, row_start: 3, col_end: 7, row_end: 7 })
    })

    it('allows a tile to occupy a corner after resizing', () => {
        expect(resizedContainerRect(box(0, 0, 8), 'bottom', { col: 0, row: 0 }, [tile(0, 0)])).toEqual({ col_start: 0, row_start: 0, col_end: 3, row_end: 3 })
    })

    it('never shrinks a container below one default tile plus two cells on each axis', () => {
        expect(MIN_CONTAINER_SPAN).toBe(AGENT_SPAN + 2)
        expect(resizedContainerRect(box(0, 0, 8), 'bottom', { col: 0, row: 0 }, [])).toEqual({ col_start: 0, row_start: 0, col_end: MIN_CONTAINER_SPAN - 1, row_end: MIN_CONTAINER_SPAN - 1 })
        expect(resizedContainerRect(box(0, 0, 8), 'top', { col: 7, row: 7 }, [])).toEqual({ col_start: 8 - MIN_CONTAINER_SPAN, row_start: 8 - MIN_CONTAINER_SPAN, col_end: 7, row_end: 7 })
    })

    it('applies the minimum size when an accessible legacy container is resized', () => {
        expect(resizedContainerRect(box(0, 0, 2), 'bottom', { col: 0, row: 0 }, [tile(0, 0)])).toEqual({ col_start: 0, row_start: 0, col_end: 3, row_end: 3 })
    })
})
