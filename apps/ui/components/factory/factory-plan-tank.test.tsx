// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routeTileLinks } from '@moldwright/ui/iso-grid'

import { TooltipProvider } from '@/components/ui/tooltip'
import { FactoryOverlay } from './FactoryOverlay'
import { FactoryWorld } from './FactoryWorld'
import { centreOf, toWorld } from './factory-rest'
import { factoryScene } from './factory-scene'

const probe = vi.hoisted(() => ({ props: null as null | { worldOverlay: () => ReactNode } }))
vi.mock('@moldwright/ui/iso-grid', async importOriginal => {
    const mod = await importOriginal<typeof import('@moldwright/ui/iso-grid')>()
    return { ...mod, IsoGrid: (props: { worldOverlay: () => ReactNode }) => { probe.props = props; return null } }
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { probe.props = null })

const render = (t: number) => {
    const frame = factoryScene(t, 0)
    const routes = routeTileLinks(frame.tiles, frame.links)
    const html = renderToStaticMarkup(<FactoryOverlay tiles={frame.tiles} routes={routes} pods={frame.pods} cabinets={frame.cabinets} plans={frame.plans ?? []} rejects={frame.rejects} held={false} />)
    return { frame, html }
}
const plan = (html: string) => html.match(/<div class="absolute left-0 top-0" data-plan="\d+"[\s\S]*?<\/svg><div class="fab-feature-label"[\s\S]*?<\/div><\/div><\/div>/)?.[0] ?? ''
const orbs = (html: string) => [...html.matchAll(/class="fab-orb-pos absolute" style="[^"]*translate\(([-\d.]+)px, ([-\d.]+)px\)/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
const ride = (t: number) => orbs(render(t).html).at(-1)!

describe('the planning tank and its spheres', () => {
    it('draws no planning tank outside the pass', () => {
        for (const t of [0, 10_000, 33_000, 47_500]) expect(render(t).html, `${t}`).not.toContain('data-plan=')
    })

    it('draws the parent as a cylinder showing how many of its children are filed', () => {
        const mid = plan(render(42_000).html)
        expect(mid).toContain('data-plan="321"')
        expect(mid).toContain('data-tank="feature"')
        expect(mid).toContain('data-tasks="3"')
        expect(mid).toContain('data-merged="1"')
        expect(mid).toContain('hue-rotate(150deg)')
        expect(mid).toContain('>1/3<')
        expect(mid).toContain('#321 Polish')
        expect(plan(render(45_500).html)).toContain('data-merged="3"')
        expect(plan(render(39_000).html)).toContain('data-merged="0"')
    })

    it('draws no tank for a plan whose desk tile is missing', () => {
        const frame = factoryScene(42_000, 0)
        const tiles = frame.tiles.filter(t => t.id !== 'plan-321')
        const html = renderToStaticMarkup(<FactoryOverlay tiles={tiles} routes={new Map()} pods={[]} cabinets={[]} plans={frame.plans ?? []} rejects={0} held={false} />)
        expect(html).not.toContain('data-plan=')
    })

    it('moves a filed child along the belt from the desk towards the Loader', () => {
        const frame = factoryScene(40_000, 0)
        const loader = toWorld(centreOf(frame.tiles.find(t => t.id === 'Delegator')!))
        const distance = (t: number) => { const o = ride(t); return Math.hypot(o.x - loader.x, o.y - loader.y) }
        expect(render(40_000).frame.pods.filter(p => p.path[0] === 'plan-321')).toHaveLength(1)
        expect(distance(41_000)).toBeLessThan(distance(40_000))
        expect(distance(41_600)).toBeLessThan(distance(41_000))
    })

    it('reaches the floor through FactoryWorld', async () => {
        const el = document.createElement('div')
        const root = createRoot(el)
        await act(async () => { root.render(<TooltipProvider><FactoryWorld scene={(_, now) => factoryScene(42_000, now)} /></TooltipProvider>) })
        expect(renderToStaticMarkup(<>{probe.props!.worldOverlay()}</>)).toContain('data-plan="321"')
        await act(async () => root.unmount())
    })
})
