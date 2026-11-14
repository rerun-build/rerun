import { describe, expect, it } from 'vitest'

import { applyMoves, canMove, readMoves } from './factory-layout'
import { COPY_CELLS, CODE, factoryScene } from './factory-scene'

// Six builds run at 6 s into the loop, so `code`'s copies are on the floor.
const tiles = factoryScene(6_000, 0).tiles
const at = (list: typeof tiles, id: string) => list.find(t => t.id === id)!.position

describe('factory layout', () => {
    it('moves a dragged object and makes the floor objects draggable, not the copies', () => {
        const moved = applyMoves(tiles, { rejects: { col: 12, row: 33 } })
        expect(at(moved, 'rejects')).toEqual({ col: 12, row: 33 })
        expect(moved.find(t => t.id === 'LINUS')!.draggable).toBe(true)
        expect(moved.find(t => t.id === 'cab-320')!.draggable).toBe(true)
        expect(moved.filter(t => t.id.startsWith('code-copy')).every(t => !t.draggable)).toBe(true)
    })

    it("moves a coworker's copies with it", () => {
        const copy = tiles.find(t => t.id.startsWith('code-copy'))!
        const moved = applyMoves(tiles, { code: { col: CODE.col + 1, row: CODE.row + 2 } })
        expect(at(moved, copy.id)).toEqual({ col: copy.position.col + 1, row: copy.position.row + 2 })
    })

    it('refuses a place on another object or on a cell a copy takes', () => {
        expect(canMove(tiles, {}, 'rejects', at(tiles, 'BRUCE'))).toBe(false)
        expect(canMove(tiles, {}, 'BRUCE', COPY_CELLS.LINUS[1])).toBe(false)
        expect(canMove(tiles, {}, 'rejects', { col: 12, row: 33 })).toBe(true)
        expect(canMove(tiles, {}, 'code-copy-330', { col: 12, row: 33 })).toBe(false)
    })

    it('reads back only what still makes a layout', () => {
        expect(readMoves('not json', tiles)).toEqual({})
        expect(readMoves('[1]', tiles)).toEqual({})
        const kept = readMoves(JSON.stringify({ rejects: { col: 12, row: 33 }, BRUCE: { col: 1.5, row: 2 }, ghost: { col: 1, row: 1 }, LARRY: at(tiles, 'LINUS') }), tiles)
        expect(kept).toEqual({ rejects: { col: 12, row: 33 } })
    })
})
