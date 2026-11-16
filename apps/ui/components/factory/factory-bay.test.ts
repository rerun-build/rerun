import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routeTileLinks, type AxisPoint, type Container, type ContainerCells, type Tile, type TileLink } from '@rerun/ui/iso-grid'
import { factorySnapshotSchema, type FactorySnapshot } from '@rerun/contracts'

import { applyMoves, beltCells, copyTree, treeRoutes } from './factory-layout'
import { hits, lineUp, podPath, sphereShapes, tileShapes, workSpot } from './factory-rest'
import { CODE, copySeat, factoryScene, LOOP_MS } from './factory-scene'
import { sceneFromSnapshot } from './from-snapshot'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const SAMPLE = path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json')
const NOW = Date.parse('2026-11-14T03:24:40Z')
const OWNERS = ['code', 'LARRY', 'LINUS', 'BRUCE', 'search']
const BAYS = ['code', 'LARRY', 'LINUS', 'BRUCE']
const REVIEWERS = ['LINUS', 'BRUCE']
const ROLE: Record<string, 'building' | 'reviewing'> = { code: 'building', LARRY: 'building', LINUS: 'reviewing', BRUCE: 'reviewing', search: 'building' }

type Scene = { tiles: Tile[]; links: TileLink[]; containers: Container[] }

const CAPS: Record<string, number> = JSON.parse(readFileSync(path.join(ROOT, 'tools/factory/control-bounds.json'), 'utf8')).copies

function live(copies: number | ((who: string) => number)): Scene {
    const count = typeof copies === 'number' ? () => copies : copies
    const s: FactorySnapshot = factorySnapshotSchema.parse(JSON.parse(readFileSync(SAMPLE, 'utf8')))
    const job = (issue: number, over: Partial<FactorySnapshot['jobs'][number]>) => ({ ...s.jobs[0], issue, parent: null, enteredAt: '2026-11-14T03:20:00Z', ...over })
    const queued = Array.from({ length: 20 }, (_, i) => job(1900 + i, { state: 'queued', coworker: null, copy: null }))
    const working = OWNERS.flatMap((who, i) => Array.from({ length: count(who) - 1 }, (_, c) => job(2000 + 100 * i + c, { state: ROLE[who], coworker: who, copy: c + 2 })))
    const f = sceneFromSnapshot({ ...s, holds: [], jobs: [...queued, ...working] }, NOW)
    return { tiles: f.tiles, links: f.links, containers: f.containers }
}

function sample(copies: number): Scene {
    const f = factoryScene(6_000, 0)
    const solid = f.tiles.filter(t => !t.id.includes('-copy'))
    const extra = OWNERS.flatMap(who => {
        const own = solid.find(t => t.id === who)!
        return Array.from({ length: copies - 1 }, (_, c) => ({ ...own, id: `${who}-copy-${c + 2}`, position: copySeat(own.position, c), ariaLabel: `${who}, a copy` }))
    })
    const traces = extra.map(t => ({ source: t.id.split('-copy')[0], target: t.id, variant: 'trace' as const }))
    return { tiles: [...solid, ...extra], links: [...f.links.filter(l => l.variant === 'belt'), ...traces], containers: f.containers }
}

const fp = (t: Tile) => ({ col: t.position.col, row: t.position.row, span: t.span ?? 2 })
const hit = (a: { col: number; row: number; span: number }, b: { col: number; row: number; span: number }) =>
    a.col < b.col + b.span && b.col < a.col + a.span && a.row < b.row + b.span && b.row < a.row + a.span
const near = (t: Tile, cells: Set<string>, reach: number) => {
    for (let c = t.position.col - reach; c < t.position.col + 2 + reach; c++) for (let r = t.position.row - reach; r < t.position.row + 2 + reach; r++) if (cells.has(`${c},${r}`)) return `${c},${r}`
    return null
}
const turn = (a: AxisPoint, b: AxisPoint, c: AxisPoint) => Math.sign((b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u))
const crosses = (p: AxisPoint[], q: AxisPoint[]) => p.slice(1).some((b, i) => q.slice(1).some((d, j) => {
    const a = p[i], c = q[j]
    return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0
}))
const ownerOf = (id: string) => OWNERS.find(o => id.toLowerCase().startsWith(`${o.toLowerCase()}-copy`))!
const inside = (b: ContainerCells, t: Tile) => t.position.col >= b.col_start && t.position.col + 1 <= b.col_end && t.position.row >= b.row_start && t.position.row + 1 <= b.row_end
const boxOf = (s: Scene, t: Tile) => s.containers.find(b => inside(b, t))

function holds(s: Scene, moves: Record<string, { col: number; row: number }> = {}) {
    const placed = applyMoves(s.tiles, moves, s.containers, s.links)
    const tree = copyTree(placed, s.links)
    const routes = treeRoutes(routeTileLinks(placed, tree), tree, s.links)
    const belts = beltCells(placed, s.links)
    const beltRoutes = s.links.filter(l => l.variant === 'belt').map(l => routes.get(`${l.source}->${l.target}`) ?? [])
    const copies = placed.filter(t => t.id.includes('-copy'))
    const solid = placed.filter(t => !t.id.includes('-copy'))
    const byId = new Map(placed.map(t => [t.id, t]))
    const queue = podPath(['Delegator', 'code'], byId, routes)
    const waiting = Array.from({ length: 20 }, (_, i) => sphereShapes(lineUp(queue, i), false)).flat()
    for (const c of copies) {
        const who = ownerOf(c.id)
        const owner = byId.get(who)!
        expect(near(c, belts, 1), `${c.id} next to a belt`).toBeNull()
        expect(hits(tileShapes(c), waiting), `${c.id} under the waiting line`).toBe(false)
        for (const t of solid) expect(hit(fp(c), fp(t)), `${c.id} on ${t.id}`).toBe(false)
        for (const o of copies) if (o.id !== c.id) expect(hit(fp(c), fp(o)), `${c.id} on ${o.id}`).toBe(false)
        if (BAYS.includes(who)) expect(boxOf(s, c), `${c.id} in the box of ${who}`).toBe(boxOf(s, owner))
        else expect(boxOf(s, c), `${c.id} in a box`).toBeDefined()
        expect((routes.get(`${who}->${c.id}`) ?? []).length, `${c.id} is reached along the lines`).toBeGreaterThanOrEqual(2)
        const line = tree.find(l => l.target === c.id)!
        const drawn = routes.get(`${line.source}->${c.id}`) ?? []
        for (const belt of beltRoutes) expect(crosses(drawn, belt), `${line.source} to ${c.id} crosses a belt`).toBe(false)
    }
    for (const who of BAYS) {
        const mine = copies.filter(c => ownerOf(c.id) === who)
        expect(mine.length, `${who} copies all seated`).toBe(s.tiles.filter(t => t.id.includes('-copy') && ownerOf(t.id) === who).length)
        if (!mine.length) continue
        const cols = mine.map(c => c.position.col), rows = mine.map(c => c.position.row)
        const [short, long] = [Math.max(...cols) - Math.min(...cols), Math.max(...rows) - Math.min(...rows)].sort((a, b) => a - b)
        expect(short, `${who} bay depth`).toBeLessThanOrEqual(6)
        expect(long, `${who} bay width`).toBeLessThanOrEqual(12)
    }
    return placed
}

describe('the copy bay', () => {
    for (const [name, scene] of [['sample', sample], ['live', live]] as const) {
        it(`${name}: every copy from 2 to 15 of every coworker stands in its bay, clear of belts, the waiting line and other tiles`, () => {
            for (let n = 2; n <= 15; n++) holds(scene(n))
        })

        it(`${name}: moving a coworker moves its bay with it and the rules still hold`, () => {
            const s = scene(15)
            const before = applyMoves(s.tiles, {}, s.containers, s.links)
            const after = holds(s, { code: { col: CODE.col + 1, row: CODE.row + 2 } })
            const at = (list: Tile[]) => list.filter(t => t.id.startsWith('code-copy')).map(t => `${t.position.col},${t.position.row}`).sort()
            expect(at(after)).not.toEqual(at(before))
        })

        it(`${name}: the first ten copies of a coworker dock their job without covering another copy of it`, () => {
            const s = scene(11)
            const copies = applyMoves(s.tiles, {}, s.containers, s.links).filter(t => t.id.includes('-copy'))
            for (const c of copies) {
                const gate = REVIEWERS.includes(ownerOf(c.id))
                const at = workSpot(c, gate)
                const docked = gate ? [[{ x: at.x - 34, y: at.y - 30 }, { x: at.x, y: at.y - 58 }, { x: at.x + 44, y: at.y - 30 }, { x: at.x, y: at.y - 2 }]] : sphereShapes(at, false)
                for (const o of copies) if (o.id !== c.id && ownerOf(o.id) === ownerOf(c.id)) expect(hits(docked, tileShapes(o)), `${c.id} docks over ${o.id}`).toBe(false)
            }
        })
    }

    it('live at the configured copy caps draws every copy of every coworker with a bay, clear of the lines', () => {
        const drawn = holds(live(who => CAPS[who])).filter(t => t.id.includes('-copy'))
        for (const who of BAYS) expect(drawn.filter(t => ownerOf(t.id) === who).length, who).toBe(CAPS[who] - 1)
        expect(drawn.filter(t => ownerOf(t.id) === 'search').length).toBe(2)
    })

    it('the sample scene as it runs keeps its copies in bays clear of the lines through the whole loop', () => {
        for (let t = 0; t < LOOP_MS; t += 2_000) {
            const f = factoryScene(t, 0)
            holds({ tiles: f.tiles, links: f.links, containers: f.containers })
        }
    })

    it('a coworker dragged into a small box draws only the copies it can seat clear of the lines', () => {
        const s = live(15)
        const box = s.containers.find(b => b.id === 'dispatch')!
        const free = { col: box.col_start, row: box.row_end - 1 }
        const placed = applyMoves(s.tiles, { LARRY: free }, s.containers, s.links)
        const belts = beltCells(placed, s.links)
        const copies = placed.filter(t => t.id.startsWith('LARRY-copy'))
        for (const c of copies) {
            expect(near(c, belts, 1), `${c.id} next to a belt`).toBeNull()
            for (const t of placed) if (t.id !== c.id) expect(hit(fp(c), fp(t)), `${c.id} on ${t.id}`).toBe(false)
        }
    })

    it('seats the copy of any coworker, a planner too, clear of the lines', () => {
        const f = factoryScene(40_000, 0)
        const planner = f.tiles.find(t => t.id === 'Scope Shaper')!
        const copy = { ...planner, id: 'Scope Shaper-copy-2', position: copySeat(planner.position, 0) }
        const links = [...f.links, { source: planner.id, target: copy.id, variant: 'trace' as const }]
        const placed = applyMoves([...f.tiles, copy], {}, f.containers, links)
        const seat = placed.find(t => t.id === copy.id)!
        const belts = beltCells(placed, links)
        expect(near(seat, belts, 1)).toBeNull()
        for (const t of placed) if (t.id !== seat.id) expect(hit(fp(seat), fp(t)), `on ${t.id}`).toBe(false)
    })
})
