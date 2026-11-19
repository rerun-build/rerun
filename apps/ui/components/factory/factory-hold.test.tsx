import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { routeTileLinks } from '@moldwright/ui/iso-grid'

import { FactoryOverlay } from './FactoryOverlay'
import { formatLeft } from './FactoryHold'
import { toWorld } from './factory-rest'
import { factoryScene } from './factory-scene'

const render = (t: number, holdLeftMs?: number) => {
    const frame = factoryScene(t, 0)
    const routes = routeTileLinks(frame.tiles, frame.links)
    const left = holdLeftMs ?? frame.holdLeftMs
    const html = renderToStaticMarkup(<FactoryOverlay tiles={frame.tiles} routes={routes} pods={frame.pods} cabinets={frame.cabinets} rejects={frame.rejects} held={frame.held} holdLeftMs={left} links={frame.links} />)
    return { frame, routes, html }
}
const barriers = (html: string) => html.match(/<[^>]*data-hold-barrier[^>]*>/g) ?? []

describe('a hold is a red D-shaped barrier', () => {
    it('draws no barrier when nothing is held', () => {
        expect(barriers(render(6_000).html)).toHaveLength(0)
    })

    it('draws a D-shaped red barrier across each belt that leaves the Loader when held', () => {
        const { frame, html } = render(50_000)
        const n = frame.links.filter(l => l.variant === 'belt' && l.source === 'Delegator').length
        expect(n).toBe(3)
        const found = barriers(html)
        expect(found).toHaveLength(n)
        const d = html.match(/<path[^>]*data-hold-shape[^>]*>/g) ?? []
        expect(d).toHaveLength(n)
        for (const p of d) {
            expect(p).toMatch(/\bd="[^"]*A/)
            expect(p).toContain('#ef4444')
        }
        expect(found.join('')).not.toContain('rgba(')
        expect(d.join('')).not.toContain('rgba(')
    })

    it('shows the time left', () => {
        const { html } = render(50_000, 6_000)
        const lefts = [...html.matchAll(/data-hold-left[^>]*>([^<]*)</g)].map(m => m[1])
        expect(lefts).toHaveLength(3)
        for (const l of lefts) expect(l).toBe('0:06')
        expect(formatLeft(590_000)).toBe('9:50')
        expect(formatLeft(0)).toBe('0:00')
        expect(formatLeft(1)).toBe('0:01')
    })

    it('sits across the belt', () => {
        const { frame, routes, html } = render(50_000)
        const keys = frame.links.filter(l => l.variant === 'belt' && l.source === 'Delegator').map(l => `${l.source}->${l.target}`)
        expect(keys).toHaveLength(3)
        const wanted = keys.map(k => {
            const [a, b] = routes.get(k)!.map(toWorld)
            return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
        })
        const got = (html.match(/<[^>]*data-hold-rotate[^>]*>/g) ?? []).map(b => Number(b.match(/rotate\((-?[\d.]+)deg\)/)?.[1]))
        expect(got).toHaveLength(3)
        expect(frame.held).toBe(true)
        const diff = (x: number, y: number) => Math.abs((((x - y) % 360) + 540) % 360 - 180)
        for (const w of wanted) expect(got.some(g => diff(g, w) <= 1)).toBe(true)
    })

    it('stands while held and is gone after', () => {
        expect(barriers(render(50_000).html).length).toBeGreaterThan(0)
        expect(render(50_000).html).toContain('#ef4444')
        expect(barriers(render(56_500).html)).toHaveLength(0)
    })
})
