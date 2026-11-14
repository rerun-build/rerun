import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { routeTileLinks, type Tile, type TileLink } from '@rerun/ui/iso-grid'

// What routing costs on boards that are large, sparse or blocked: a tile far from the others used to
// size the whole lattice, and a target with no way in was searched across all of it, twice. The
// budgets are generous; what they hold is that the cost follows the links, not the board's extent.

const tile = (id: string, col: number, row: number, span = 2): Tile => ({ id, position: { col, row }, span, style: { color: '#fff' } })
const link = (source: string, target: string): TileLink => ({ source, target, variant: 'cable' })

const BASE = [tile('a', 1, 1), tile('b', 9, 1), tile('c', 1, 9), tile('d', 9, 9)]
const BASE_LINKS = [link('a', 'b'), link('a', 'd'), link('c', 'a')]

// A target in a closed ring of tiles two cells off it (the gaps between them are too narrow for a
// line), on a 300 x 300 board.
const RING = [144, 149, 154].flatMap(col => [144, 149, 154].filter(row => col !== 149 || row !== 149).map(row => tile(`ring${col},${row}`, col, row, 4)))
const RINGED = [tile('src', 0, 0), tile('target', 150, 150), tile('corner', 300, 300), ...RING]

const LOG = process.env.ROUTE_COST_LOG

// Best of three passes after a warm-up: a CI machine running eight test workers at once once measured
// 50.8 ms for a pass that takes ~5 ms alone. The budgets sit far below the regressions they guard
// (an idle far tile cost 454 ms, a linked one 3 s, a ringed target 5 s), so load cannot trip them.
function timed(tiles: Tile[], links: TileLink[]) {
    let routes = routeTileLinks(tiles, links) // warm the code paths once
    let ms = Infinity
    for (let i = 0; i < 3; i++) {
        const t0 = performance.now()
        routes = routeTileLinks(tiles, links)
        ms = Math.min(ms, performance.now() - t0)
    }
    return { ms, routes }
}

describe('routing cost', () => {
    it.each([
        { name: 'an idle tile at (1000,1000)', tiles: [...BASE, tile('far', 1000, 1000)], links: BASE_LINKS, budget: 250 },
        { name: 'a linked tile at (1000,1000)', tiles: [...BASE, tile('far', 1000, 1000)], links: [...BASE_LINKS, link('a', 'far')], budget: 250 },
        { name: 'a linked tile at (3000,3000)', tiles: [...BASE, tile('far', 3000, 3000)], links: [...BASE_LINKS, link('a', 'far')], budget: 250 },
        { name: 'a target ringed by tiles on 300 x 300', tiles: RINGED, links: [link('src', 'target')], budget: 1000 },
        // The value a stored layout once put in the page, which threw in render.
        { name: 'a linked tile at col 1e9', tiles: [...BASE, tile('far', 1_000_000_000, 0)], links: [...BASE_LINKS, link('far', 'a'), link('far', 'b')], budget: 250 },
    ])('routes $name within $budget ms, every pair', ({ name, tiles, links, budget }) => {
        const { ms, routes } = timed(tiles, links)
        if (LOG) appendFileSync(LOG, `${name}: ${ms.toFixed(1)} ms\n`)
        for (const l of links) expect(routes.get(`${l.source}->${l.target}`)?.length ?? 0, `${l.source}->${l.target}`).toBeGreaterThanOrEqual(2)
        expect(ms).toBeLessThan(budget)
    }, 120_000)
})
