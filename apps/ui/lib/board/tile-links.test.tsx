// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TileLinks, type Tile, type TileLink } from '@rerun/ui/iso-grid'
import { factoryScene } from '@/components/factory/factory-scene'

// The board's link layer: a cable must still draw as one thin path with its comet, and the trace and
// belt variants the factory added must draw their own parts without touching the cable's.

const tile = (id: string, col: number, row: number): Tile => ({ id, position: { col, row }, span: 2, style: { color: '#fff' } })
const TILES = [tile('a', 1, 1), tile('b', 7, 1), tile('c', 1, 7), tile('d', 7, 7)]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

function draw(links: TileLink[], tiles: Tile[] = TILES) {
    act(() => root.render(createElement(TileLinks, { tiles, liveLinks: links, containers: [], worldOffset: { left: 0, top: 0 }, svgHalfW: 500, svgHalfH: 500 })))
    return host
}

describe('TileLinks', () => {
    it('draws a cable as one thin path with one comet, and nothing of a trace or a belt', () => {
        const el = draw([{ source: 'a', target: 'b', variant: 'cable' }])
        const paths = el.querySelectorAll('svg path')
        expect(paths).toHaveLength(1)
        expect(paths[0].getAttribute('stroke-width')).toBe('1')
        expect(el.querySelectorAll('.iso-cable-comet')).toHaveLength(1)
        expect(el.querySelectorAll('.iso-trace-trail, .iso-trace-head, .iso-belt-slats')).toHaveLength(0)
    })

    it('draws a trace as its quiet line, three fading trail strokes and one head', () => {
        const el = draw([{ source: 'a', target: 'c', variant: 'trace', color: '#4ade80' }])
        const trails = [...el.querySelectorAll('.iso-trace-trail')]
        expect(trails).toHaveLength(3)
        // The fade lives on stroke-opacity: the rest animation owns `opacity`.
        const fades = trails.map(t => Number(t.getAttribute('stroke-opacity')))
        expect(fades[0]).toBeGreaterThan(fades[1])
        expect(fades[1]).toBeGreaterThan(fades[2])
        expect(el.querySelectorAll('.iso-trace-head')).toHaveLength(1)
        expect(el.querySelectorAll('.iso-cable-comet, .iso-belt-slats')).toHaveLength(0)
    })

    it('draws a belt as edge, band and running slats under the same trace', () => {
        const el = draw([{ source: 'a', target: 'd', variant: 'belt', color: '#f5a524' }])
        expect(el.querySelectorAll('.iso-belt-slats')).toHaveLength(1)
        expect(el.querySelectorAll('.iso-trace-trail')).toHaveLength(3)
        expect(el.querySelectorAll('.iso-trace-head')).toHaveLength(1)
        expect(el.querySelector('.iso-trace-head')?.getAttribute('style')).toContain('#f5a524')
    })

    it('dims the head through a wrapper when an end of its line is dimmed', () => {
        draw([{ source: 'a', target: 'b', variant: 'trace' }], [{ ...TILES[0], dimmed: true }, TILES[1]])
        const head = host.querySelector('.iso-trace-head') as HTMLElement
        expect(head.style.opacity).toBe('')
        expect((head.parentElement as HTMLElement).style.opacity).not.toBe('')
    })

    describe('chevrons', () => {
        const chevrons = (el: Element) => [...el.querySelectorAll('[data-belt-chevron]')]
        const pts = (c: Element) => (c.getAttribute('points') ?? '').trim().split(/\s+/).map(p => p.split(',').map(Number) as [number, number])
        // Tile centre in the SVG frame of `draw` (offset 0, half size 500): same convention as the layer.
        const centre = (t: Tile) => {
            const u = t.position!.col + (t.span ?? 1) / 2
            const v = t.position!.row + (t.span ?? 1) / 2
            return [(u - v) * 28 + 28 + 500, (u + v) * 14 + 500] as const
        }
        const dist = (p: readonly [number, number] | readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1])
        const pointsTowards = (el: Element, target: Tile) =>
            chevrons(el).every(c => {
                const [t1, tip, t2] = pts(c)
                const mid = [(t1[0] + t2[0]) / 2, (t1[1] + t2[1]) / 2]
                const goal = centre(target)
                return dist(tip, goal) < dist(mid, goal)
            })

        it('draws no chevron on a belt that does not ask, nor on a cable', () => {
            expect(chevrons(draw([{ source: 'a', target: 'b', variant: 'belt' }]))).toHaveLength(0)
            expect(chevrons(draw([{ source: 'a', target: 'b', variant: 'cable', chevrons: true }]))).toHaveLength(0)
        })

        it('draws chevrons along a belt that asks, at least one, none on a trace', () => {
            expect(chevrons(draw([{ source: 'a', target: 'b', variant: 'belt', chevrons: true }])).length).toBeGreaterThanOrEqual(2)
            expect(chevrons(draw([{ source: 'a', target: 'b', variant: 'trace', chevrons: true }]))).toHaveLength(0)
        })

        it('points every chevron towards the target', () => {
            const fwd = draw([{ source: 'a', target: 'b', variant: 'belt', chevrons: true }])
            expect(chevrons(fwd).length).toBeGreaterThan(0)
            expect(pointsTowards(fwd, TILES[1])).toBe(true)
            const back = draw([{ source: 'b', target: 'a', variant: 'belt', chevrons: true }])
            expect(chevrons(back).length).toBeGreaterThan(0)
            expect(pointsTowards(back, TILES[0])).toBe(true)
            expect(pointsTowards(back, TILES[1])).toBe(false)
        })

        it('keeps the chevrons on a belt that stands still', () => {
            const el = draw([{ source: 'a', target: 'b', variant: 'belt', still: true, chevrons: true }])
            expect(chevrons(el).length).toBeGreaterThanOrEqual(2)
            expect(el.querySelectorAll('.iso-belt-slats, .iso-trace-trail')).toHaveLength(0)
        })

        it('draws at least one chevron per belt of the factory sample, and none as the links are', () => {
            const frame = factoryScene(6_000, 0)
            const belts = frame.links.filter(l => l.variant === 'belt')
            expect(belts.length).toBeGreaterThan(0)
            expect(chevrons(draw(frame.links, frame.tiles))).toHaveLength(0)
            const el = draw(frame.links.map(l => (l.variant === 'belt' ? { ...l, chevrons: true } : l)), frame.tiles)
            expect(chevrons(el).length).toBeGreaterThanOrEqual(belts.length)
        })
    })
})
