import { describe, expect, it } from 'vitest'
import { routeTileLinks } from '@rerun/ui/iso-grid'

import { applyMoves, canMove, readMoves } from './factory-layout'
import { COPY_CELLS, CODE, factoryScene } from './factory-scene'

// Six builds run at 6 s into the loop, so `code`'s copies are on the floor.
const scene = factoryScene(6_000, 0)
const tiles = scene.tiles
const containers = scene.containers
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
        expect(readMoves(JSON.stringify({ rejects: { col: 12, row: 33 }, BRUCE: { col: 1.5, row: 2 }, ghost: { col: 1, row: 1 } }), tiles)).toEqual({ rejects: { col: 12, row: 33 } })
        // Two objects on one cell: the arrangement does not hold, the scene goes back to its defaults.
        expect(readMoves(JSON.stringify({ rejects: { col: 12, row: 33 }, LARRY: at(tiles, 'LINUS') }), tiles)).toEqual({})
    })

    it('reads back a layout built drag by drag, each drop valid only after the one before', () => {
        const drops: [string, { col: number; row: number }][] = [['LARRY', { col: 30, row: 17 }], ['code', { col: 22, row: 14 }], ['LARRY', { col: 22, row: 9 }]]
        let moves = {}
        for (const [id, cell] of drops) {
            expect(canMove(tiles, moves, id, cell, containers), `${id} to ${cell.col},${cell.row}`).toBe(true)
            moves = { ...moves, [id]: cell }
        }
        expect(readMoves(JSON.stringify(moves), tiles, containers)).toEqual({ code: { col: 22, row: 14 }, LARRY: { col: 22, row: 9 } })
    })

    it('refuses a place outside every box, so a far-off value in storage cannot reach the router', () => {
        const far = JSON.stringify({ Delegator: { col: 1_000_000_000, row: 0 } })
        expect(readMoves(far, tiles, containers)).toEqual({})
        expect(canMove(tiles, {}, 'rejects', { col: 12, row: 33 }, containers)).toBe(false)
        // Without the boxes the value is kept, and routing it still returns every line.
        const placed = applyMoves(tiles, readMoves(far, tiles))
        const routes = routeTileLinks(placed, scene.links)
        for (const l of scene.links) expect(routes.get(`${l.source}->${l.target}`)?.length ?? 0).toBeGreaterThanOrEqual(2)
    })

    it('keeps the place of an object that is not on the floor now', () => {
        expect(readMoves(JSON.stringify({ 'cab-999': { col: 3, row: 3 }, rejects: { col: 18, row: 29 } }), tiles, containers)).toEqual({ 'cab-999': { col: 3, row: 3 }, rejects: { col: 18, row: 29 } })
    })
})
