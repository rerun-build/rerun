// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routeTileLinks, type Tile } from '@rerun/ui/iso-grid'
import { factorySnapshotSchema, type FactorySnapshot } from '@rerun/contracts'

import { FactoryOverlay } from './FactoryOverlay'
import { atDistance, inScanner, lineUp, podPath, settles, workSpot, type P } from './factory-rest'
import { LOOP_MS, factoryScene, type CabinetView, type PodView } from './factory-scene'
import { sceneFromSnapshot } from './from-snapshot'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const NOW = Date.parse('2026-11-14T03:24:40Z')
const sample = (): FactorySnapshot => factorySnapshotSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json'), 'utf8')))

type Frame = { tiles: Tile[]; links: Parameters<typeof routeTileLinks>[1]; pods: PodView[]; cabinets: CabinetView[]; rejects: number; held: boolean }
const el = (f: Frame) => <FactoryOverlay tiles={f.tiles} routes={routeTileLinks(f.tiles, f.links)} pods={f.pods} cabinets={f.cabinets} rejects={f.rejects} held={f.held} />
const spots = (f: Frame): Map<number, P> => {
    const doc = document.implementation.createHTMLDocument('x')
    doc.body.innerHTML = renderToStaticMarkup(el(f))
    const out = new Map<number, P>()
    for (const svg of Array.from(doc.querySelectorAll('[data-orb]'))) {
        const gate = svg.closest('.fab-scanner')
        const node = (gate ?? svg.closest('.fab-orb-pos')) as HTMLElement
        const m = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(node.getAttribute('style') ?? '')!
        out.set(Number(svg.getAttribute('data-orb')), { x: Number(m[1]), y: Number(m[2]) + (gate ? 0 : 18) })
    }
    return out
}
const near = (a: P, b: P) => { expect(a.x).toBeCloseTo(b.x, 3); expect(a.y).toBeCloseTo(b.y, 3) }
const tileOf = (f: Frame, id: string) => f.tiles.find(t => t.id === id)!
const holderTile = (f: Frame, p: PodView) => f.tiles.find(t => t.id === p.path[p.path.length - 1])
const podOf = (f: Frame, issue: number) => f.pods.find(p => p.issue === issue)!

describe('sphere places and hover card', () => {
    afterEach(() => { vi.useRealTimers() })

    it('sits at the same spot in front of its worker, every time', () => {
        const a = sceneFromSnapshot(sample(), NOW)
        const b = sceneFromSnapshot(sample(), NOW + 60_000)
        for (const issue of [330, 333, 331]) {
            const p = podOf(a, issue)
            const holder = holderTile(a, p)!
            expect(holder).toBeTruthy()
            const want = workSpot(holder, inScanner(p))
            near(spots(a).get(issue)!, want)
            expect(spots(b).get(issue)).toEqual(spots(a).get(issue))
        }
    })

    it('moves along a belt only on a handoff', () => {
        let rested = 0, moving = 0
        for (let t = 0; t <= LOOP_MS; t += 500) {
            const f = factoryScene(t, 0)
            const at = spots(f)
            for (const p of f.pods) {
                const holder = holderTile(f, p)
                if (!settles(p) || !holder) continue
                if (p.travel >= 1) { rested++; near(at.get(p.issue)!, workSpot(holder, inScanner(p))) }
                else if (p.state === 'working' && p.travel > 0 && p.travel < 0.9) {
                    moving++
                    const w = workSpot(holder, inScanner(p)), g = at.get(p.issue)!
                    expect(Math.hypot(g.x - w.x, g.y - w.y)).toBeGreaterThan(0.5)
                }
            }
        }
        expect(rested).toBeGreaterThan(0)
        expect(moving).toBeGreaterThan(0)
    })

    it('lines up waiting tasks evenly from the start of the belt, longest wait first', () => {
        const s = sample()
        const set: Record<number, string> = { 330: '2026-11-14T03:21:05Z', 331: '2026-11-14T03:20:00Z', 333: '2026-11-14T03:22:00Z' }
        for (const j of s.jobs) if (set[j.issue]) Object.assign(j, { state: 'queued', enteredAt: set[j.issue], coworker: null, copy: null })
        const f = sceneFromSnapshot(s, NOW)
        const at = spots(f)
        const pts = podPath(podOf(f, 331).path, new Map(f.tiles.map(t => [t.id, t])), routeTileLinks(f.tiles, f.links))
        ;[331, 330, 332, 333].forEach((issue, i) => {
            expect(podOf(f, issue).path.slice(0, 2).join('>')).toBe('Delegator>code')
            near(at.get(issue)!, lineUp(pts, i))
        })
        expect(atDistance(pts, 22)).toBeTruthy()
    })

    it('lines up review_wait tasks on their own belt, not on one another', () => {
        const s = sample()
        for (const j of s.jobs) if (j.issue === 330 || j.issue === 333) Object.assign(j, { state: 'review_wait', coworker: null, copy: null })
        const f = sceneFromSnapshot(s, NOW)
        const two = [330, 333].map(i => podOf(f, i))
        for (const p of two) { expect(p.path.join('>')).toBe('code>LINUS'); expect(p.queue).toBe(0); expect(p.travel).toBeCloseTo(0.5, 5) }
        const at = spots(f)
        const a = at.get(330)!, b = at.get(333)!
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(40, 0)
    })

    it('the hover card says issue, title, stage, holder, time in stage and PR', () => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
        ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
        const f = sceneFromSnapshot(sample(), NOW)
        const host = document.createElement('div')
        document.body.appendChild(host)
        const root = createRoot(host)
        act(() => { root.render(el(f)) })
        const hover = (issue: number) => act(() => { host.querySelector(`[data-orb="${issue}"]`)!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })) })
        hover(331)
        const card = host.querySelector('[data-card="331"]')!
        for (const want of ['#331', 'stage: review', 'holder: LINUS · 1', 'in stage: 1m 0s', 'PR #341']) expect(card.textContent).toContain(want)
        hover(332)
        const c2 = host.querySelector('[data-card="332"]')!
        expect(c2.querySelector('[data-card-line="holder"]')).toBeNull()
        expect(c2.querySelector('[data-card-line="pr"]')).toBeNull()
        expect(c2.querySelector('[data-card-line="since"]')).not.toBeNull()
        act(() => root.unmount())
        host.remove()
    })
})
