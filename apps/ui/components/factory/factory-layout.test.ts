import { describe, expect, it } from 'vitest'
import { routeTileLinks } from '@moldwright/ui/iso-grid'

import { applyMoves, canMove, dropReason, readMoves } from './factory-layout'
import { CODE, factoryScene } from './factory-scene'

const scene = factoryScene(6_000, 0)
const tiles = scene.tiles
const containers = scene.containers
const at = (list: typeof tiles, id: string) => list.find(t => t.id === id)!.position
const copyAt = applyMoves(tiles, {}, containers).find(t => t.id.startsWith('code-copy'))!.position

describe('factory layout', () => {
    it('moves a dragged object and makes the floor objects draggable, not the copies', () => {
        const moved = applyMoves(tiles, { rejects: { col: 12, row: 33 } })
        expect(at(moved, 'rejects')).toEqual({ col: 12, row: 33 })
        expect(moved.find(t => t.id === 'LINUS')!.draggable).toBe(true)
        expect(moved.find(t => t.id === 'cab-320')!.draggable).toBe(true)
        expect(moved.filter(t => t.id.startsWith('code-copy')).every(t => !t.draggable)).toBe(true)
    })

    it('keeps every copy next to its coworker, clear of every object and of each other, after the coworker moves', () => {
        for (const moves of [{}, { code: { col: CODE.col + 1, row: CODE.row + 2 } }] as Record<string, { col: number; row: number }>[]) {
            const placed = applyMoves(tiles, moves, containers)
            const code = at(placed, 'code')
            const copies = placed.filter(t => t.id.startsWith('code-copy'))
            expect(copies.length).toBeGreaterThan(0)
            const fp = (t: (typeof tiles)[number]) => ({ ...t.position, span: t.span ?? 2 })
            const hit = (a: ReturnType<typeof fp>, b: ReturnType<typeof fp>) => a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.span && b.row < a.row + a.span
            copies.forEach((c, i) => {
                expect(containers.some(b => c.position.col >= b.col_start && c.position.col + 1 <= b.col_end && c.position.row >= b.row_start && c.position.row + 1 <= b.row_end)).toBe(true)
                for (const m of placed.filter(t => (t.draggable || false) && t.id !== c.id)) expect(hit(fp(c), fp(m))).toBe(false)
                copies.slice(i + 1).forEach(o => expect(hit(fp(c), fp(o))).toBe(false))
                expect(Math.max(Math.abs(c.position.col - code.col), Math.abs(c.position.row - code.row))).toBeLessThanOrEqual(24)
            })
        }
    })

    it('refuses a place on another object or on a cell a copy takes', () => {
        expect(canMove(tiles, {}, 'rejects', at(tiles, 'BRUCE'))).toBe(false)
        expect(canMove(tiles, {}, 'BRUCE', copyAt)).toBe(true)
        expect(canMove(tiles, {}, 'rejects', { col: 12, row: 33 })).toBe(true)
        expect(canMove(tiles, {}, 'code-copy-330', { col: 12, row: 33 })).toBe(false)
    })

    it('a coworker can be dropped where a copy stands, and the copy moves aside', () => {
        expect(canMove(tiles, {}, 'rejects', copyAt, containers)).toBe(true)
        const moved = applyMoves(tiles, { rejects: copyAt }, containers)
        const r = moved.find(t => t.id === 'rejects')!
        for (const c of moved.filter(t => t.id.startsWith('code-copy'))) {
            const hit = c.position.col < r.position.col + 2 && r.position.col < c.position.col + 2 && c.position.row < r.position.row + 2 && r.position.row < c.position.row + 2
            expect(hit).toBe(false)
        }
        expect(r.containerId).toBe('build')
    })

    it('lets an object go into any box', () => {
        for (const id of ['rejects', 'search']) {
            const own = tiles.find(t => t.id === id)!.containerId
            for (const b of containers.filter(c => c.id !== own)) {
                let ok = false
                for (let col = b.col_start; col <= b.col_end && !ok; col++) for (let row = b.row_start; row <= b.row_end && !ok; row++) ok = canMove(tiles, {}, id, { col, row }, containers)
                expect(ok, `${id} into ${b.id}`).toBe(true)
            }
        }
    })

    it('says why a drop is refused', () => {
        expect(dropReason(tiles, {}, 'rejects', at(tiles, 'BRUCE'), containers)).toBe('another object is here')
        expect(dropReason(tiles, {}, 'rejects', { col: 1000, row: 1000 }, containers)).toBe('outside every box')
        expect(dropReason(tiles, {}, 'rejects', { col: -5, row: -5 }, containers)).toBe('outside every box')
        expect(dropReason(tiles, {}, 'code-copy-330', { col: 12, row: 33 }, containers)).toBe('this cannot be moved')
        expect(dropReason(tiles, {}, 'rejects', { col: 18, row: 22 }, containers)).toBeNull()
    })

    it('reads back only what still makes a layout', () => {
        expect(readMoves('not json', tiles)).toEqual({})
        expect(readMoves('[1]', tiles)).toEqual({})
        expect(readMoves(JSON.stringify({ rejects: { col: 12, row: 33 }, BRUCE: { col: 1.5, row: 2 }, ghost: { col: 1, row: 1 } }), tiles)).toEqual({ rejects: { col: 12, row: 33 } })
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
        const placed = applyMoves(tiles, readMoves(far, tiles))
        const routes = routeTileLinks(placed, scene.links)
        for (const l of scene.links) expect(routes.get(`${l.source}->${l.target}`)?.length ?? 0).toBeGreaterThanOrEqual(2)
    })

    it('still reads back a layout saved at the far edge of the rooms as they were before they grew', () => {
        const saved = { rejects: { col: 45, row: 40 }, LARRY: { col: 44, row: 18 }, code: { col: 17, row: 0 } }
        expect(readMoves(JSON.stringify(saved), tiles, containers)).toEqual(saved)
    })

    it('keeps the place of an object that is not on the floor now', () => {
        expect(readMoves(JSON.stringify({ 'cab-999': { col: 3, row: 3 }, rejects: { col: 18, row: 29 } }), tiles, containers)).toEqual({ 'cab-999': { col: 3, row: 3 }, rejects: { col: 18, row: 29 } })
    })
})
