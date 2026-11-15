import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { routeTileLinks } from '@rerun/ui/iso-grid'

import { Gate } from './FactoryGate'
import { FactoryOverlay } from './FactoryOverlay'
import { inScanner } from './factory-rest'
import { LOOP_MS, factoryScene } from './factory-scene'

const render = (t: number) => {
    const frame = factoryScene(t, 0)
    const routes = routeTileLinks(frame.tiles, frame.links)
    const html = renderToStaticMarkup(<FactoryOverlay tiles={frame.tiles} routes={routes} pods={frame.pods} cabinets={frame.cabinets} rejects={frame.rejects} held={false} />)
    return { frame, html }
}
const gates = (html: string) => html.split('<div class="fab-scanner').slice(1)
const first = (s: string, re: RegExp) => s.match(re)?.[1]
const stub = (g: string, kind: string) => g.match(new RegExp(`<path[^>]*data-exit="${kind}"[^>]*>`))?.[0] ?? ''
const startOf = (tag: string) => first(tag, /\bd="(M[^ L]+)/)

describe('a review is a diamond gate', () => {
    it('draws a review as a diamond gate, not a box', () => {
        const { html } = render(21_750)
        expect(html.match(/data-shape="diamond"/g)?.length).toBe(3)
        for (const c of ['fab-scan-back', 'fab-scan-top', 'fab-scan-frame']) expect(html).not.toContain(c)
    })

    it('gives a pass and a fail exit on two different corners', () => {
        const g = gates(render(21_750).html)[0]
        const pass = stub(g, 'pass'), fail = stub(g, 'fail')
        expect(pass).not.toBe('')
        expect(fail).not.toBe('')
        expect(startOf(pass)).toBe('M34,-30')
        expect(startOf(fail)).toBe('M0,-2')
    })

    it('lights the exit the verdict names', () => {
        const seen: Record<string, string | undefined> = {}
        for (const v of ['pass', 'fail'] as const) {
            let at = -1
            for (let t = 0; t <= LOOP_MS && at < 0; t += 250) if (factoryScene(t, 0).pods.some(p => p.verdict === v)) at = t
            if (at >= 0) seen[v] = gates(render(at).html).find(g => g.includes(`data-verdict="${v}"`))
        }
        expect(seen.pass).toBeDefined()
        expect(seen.fail).toBeDefined()
        expect(stub(seen.pass!, 'pass')).toContain('#2dd4a3')
        expect(stub(seen.pass!, 'fail')).toContain('#5b6485')
        expect(stub(seen.fail!, 'fail')).toContain('#ef4444')
    })

    it('is solid', () => {
        const pod = factoryScene(21_750, 0).pods.find(p => p.verdict === undefined || p.verdict === null) ?? factoryScene(21_750, 0).pods[0]
        const g = renderToStaticMarkup(<Gate pod={pod} at={{ x: 0, y: 0 }}>{null}</Gate>)
        expect(g).toContain('data-shape="diamond"')
        expect(g).not.toContain('rgba(')
        expect(g).not.toContain('fill-opacity')
        expect(g).not.toMatch(/\sopacity="/)
    })

    it('keeps one orb per sphere and one diamond per sphere in review', () => {
        const { frame, html } = render(21_750)
        expect(html.match(/data-orb="/g)?.length).toBe(frame.pods.length)
        expect(html.match(/data-shape="diamond"/g)?.length).toBe(frame.pods.filter(inScanner).length)
    })
})
