import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { routeTileLinks } from '@moldwright/ui/iso-grid'

import { FactoryOverlay } from './FactoryOverlay'
import { LOOP_MS, factoryScene, type CabinetView } from './factory-scene'

const render = (t: number) => {
    const frame = factoryScene(t, 0)
    const routes = routeTileLinks(frame.tiles, frame.links)
    const html = renderToStaticMarkup(<FactoryOverlay tiles={frame.tiles} routes={routes} pods={frame.pods} cabinets={frame.cabinets} rejects={frame.rejects} held={false} />)
    return { frame, html }
}
const tanks = (html: string) => html.match(/<div class="fab-feature[^>]*data-tank="feature"[\s\S]*?<\/svg>/g) ?? []
const num = (s: string, a: string) => Number(s.match(new RegExp(`${a}="([^"]+)"`))?.[1])
const tag = (s: string, part: string) => s.match(new RegExp(`<[a-z]+[^>]*data-part="${part}"[^>]*>`))?.[0] ?? ''
const sum = (c: CabinetView, state: string) => c.slots.filter(x => x.state === state).reduce((a, x) => a + x.arriving, 0)
const scan = (pick: (c: CabinetView) => boolean) => {
    for (let t = 0; t <= LOOP_MS; t += 250) {
        const i = factoryScene(t, 0).cabinets.findIndex(pick)
        if (i >= 0) return { ...render(t), i, t }
    }
    throw new Error('no frame')
}

describe('a feature is a tank', () => {
    it('draws a feature as a cylinder, not a sphere', () => {
        const { frame, html } = render(6_000)
        const ts = tanks(html)
        expect(ts.length).toBe(frame.cabinets.length)
        for (const t of ts) {
            expect(t.match(/<ellipse/g)?.length).toBeGreaterThanOrEqual(2)
            expect(t).not.toContain('fab-orb-glass')
            expect(t).not.toContain('<circle')
        }
    })

    it('fills gold in step with the merged tasks and red with the rejected', () => {
        for (const pick of [(c: CabinetView) => sum(c, 'merged') >= 1, (c: CabinetView) => sum(c, 'rejected') >= 1]) {
            const { frame, html, i } = scan(pick)
            const c = frame.cabinets[i], t = tanks(html)[i], n = c.slots.length
            expect(num(t, 'data-tasks')).toBe(n)
            expect(num(t, 'data-merged')).toBeCloseTo(sum(c, 'merged'), 5)
            expect(num(t, 'data-rejected')).toBeCloseTo(sum(c, 'rejected'), 5)
            const body = num(tag(t, 'body'), 'height')
            expect(num(tag(t, 'gold'), 'height') / body).toBeCloseTo((sum(c, 'merged') + sum(c, 'rejected')) / n, 2)
            expect(num(tag(t, 'red'), 'height') / body).toBeCloseTo(sum(c, 'rejected') / n, 2)
        }
    })

    it('is empty and dark at the start and glows only when full', () => {
        const start = tanks(render(0).html)
        for (const t of start) {
            expect(num(tag(t, 'gold'), 'height')).toBe(0)
            expect(t).not.toContain('data-full')
        }
        const { frame, html } = scan(c => c.slots.every(x => x.state !== 'empty' && x.arriving >= 1))
        const ts = tanks(html)
        frame.cabinets.forEach((c, i) => {
            const full = c.slots.every(x => x.state !== 'empty' && x.arriving >= 1)
            expect(ts[i].includes('data-full')).toBe(full)
        })
        expect(ts.some(t => t.includes('data-full'))).toBe(true)
    })

    it('is solid', () => {
        for (const t of tanks(render(21_750).html)) {
            expect(t).not.toContain('rgba(')
            expect(t).not.toContain('fill-opacity')
            expect(t).not.toContain('stop-opacity')
            expect(t).not.toMatch(/opacity/)
        }
    })

    it('renders two tanks with their counts at the start of the loop', () => {
        const { html } = render(6_000)
        expect(tanks(html).length).toBe(2)
        expect(html).toMatch(/0\/7/)
        expect(html).toMatch(/0\/5/)
    })
})

const rejectTank = (html: string) => html.match(/<div class="fab-reject[^>]*data-tank="rejects"[\s\S]*?rejected<\/span><\/div>/g) ?? []

describe('the reject store is a tank', () => {
    it('draws the reject store as a red cylinder', () => {
        const { html } = render(0)
        const ts = rejectTank(html)
        expect(ts.length).toBe(1)
        expect(ts[0]!.match(/<ellipse/g)?.length).toBeGreaterThanOrEqual(2)
        expect(tag(ts[0]!, 'body')).toContain('#7f1d1d')
        for (const gone of ['fab-bin-left', 'fab-bin-right', 'fab-bin-part']) expect(html).not.toContain(gone)
    })

    it('prints how many are in it, once', () => {
        const start = rejectTank(render(0).html)[0]!
        expect(num(start, 'data-count')).toBe(0)
        expect(start).not.toContain('data-filled')
        expect(start).toMatch(/>0<\/span><span>rejected/)
        let t = 0
        while (t <= LOOP_MS && factoryScene(t, 0).rejects < 1) t += 250
        expect(t).toBeLessThanOrEqual(LOOP_MS)
        const { frame, html } = render(t)
        expect(frame.rejects).toBe(1)
        const one = rejectTank(html)[0]!
        expect(num(one, 'data-count')).toBe(1)
        expect(one).toContain('data-filled')
        expect(one.match(/>1</g)?.length).toBe(1)
    })

    it('is solid', () => {
        const t = rejectTank(render(21_750).html)[0]!
        expect(t).not.toContain('rgba(')
        expect(t).not.toContain('fill-opacity')
        expect(t).not.toMatch(/opacity/)
    })

    it('stands beside two feature tanks in the sample loop', () => {
        const { html } = render(6_000)
        expect(html.match(/data-tank="rejects"/g)?.length).toBe(1)
        expect(html.match(/data-tank="feature"/g)?.length).toBe(2)
    })
})
