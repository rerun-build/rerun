import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { routeTileLinks } from '@rerun/ui/iso-grid'

import { FactoryOverlay } from './FactoryOverlay'
import { STATUS_COLOR, factoryScene } from './factory-scene'

const render = (t: number, onSelectJob?: (n: number) => void, selectedIssue?: number) => {
    const frame = factoryScene(t, 0)
    const routes = routeTileLinks(frame.tiles, frame.links)
    const html = renderToStaticMarkup(<FactoryOverlay tiles={frame.tiles} routes={routes} pods={frame.pods} cabinets={frame.cabinets} rejects={frame.rejects} held={frame.held} selectedIssue={selectedIssue} onSelectJob={onSelectJob} />)
    return { frame, html }
}
const orbs = (html: string) => html.split('<div class="fab-orb"').slice(1)
const bare = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '')
const num = (s: string, re: RegExp) => Number(s.match(re)?.[1])

describe('a task is a two-tone sphere', () => {
    it('draws a task as a two-tone sphere', () => {
        const { html } = render(6_000)
        const list = orbs(html)
        expect(list.length).toBeGreaterThan(0)
        for (const o of list) {
            expect(o).toContain('fill="#1b2140"')
            const level = num(o, /data-level="([\d.]+)"/)
            expect(Math.abs(num(o, /data-part="fill"[^>]*height="([\d.]+)"/) - level * 30)).toBeLessThanOrEqual(0.5)
        }
        expect(list.some(o => o.includes(`fill="${STATUS_COLOR.build}"`))).toBe(true)
        let review = ''
        for (let t = 0; t < 84_000 && !review; t += 500) review = orbs(render(t).html).find(o => o.includes(`fill="${STATUS_COLOR.review}"`)) ?? ''
        expect(review).not.toBe('')
    })

    it('has nothing see-through', () => {
        const markup = orbs(bare(render(6_000).html)).join('')
        for (const bad of ['rgba(', 'stopOpacity', 'stop-opacity', 'fill-opacity', 'fab-orb-glass']) expect(markup).not.toContain(bad)
    })

    it('does not move while it waits', () => {
        const { html } = render(6_000)
        expect(html).not.toContain('fab-slosh')
        expect(html).not.toContain('fab-pulse')
        const queued = orbs(html).filter(o => o.includes('data-state="queued"'))
        for (const o of queued) expect(o.split('<svg')[0]).not.toContain('animation')
    })

    it('keeps the click and the ring', () => {
        const { frame } = render(6_000)
        const issue = frame.pods[0].issue
        const { html } = render(6_000, () => {}, issue)
        const sel = orbs(html).filter(o => o.includes('data-selected="true"'))
        expect(sel.length).toBeGreaterThan(0)
        expect(sel[0]).toContain('fab-orb-ring')
        expect(orbs(html)[0]).toContain('pointer-events:auto')
    })

    it('shows one sphere per task, and a red rim when held', () => {
        const { frame: f6, html: h6 } = render(6_000)
        expect(orbs(h6).length).toBe(f6.pods.length)
        const { frame, html } = render(50_000)
        expect(frame.held).toBe(true)
        const held = orbs(html).filter(o => o.includes('data-state="held"'))
        expect(held.length).toBeGreaterThan(0)
        expect(html).toContain("data-state='held'] .fab-orb-rim { stroke: #ef4444")
    })
})
