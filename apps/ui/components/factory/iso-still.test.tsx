import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { factorySnapshotSchema, type FactorySnapshot } from '@moldwright/contracts'
import { TileBuddy, TileLinks, type Tile, type TileLink } from '@moldwright/ui/iso-grid'
import { sceneFromSnapshot } from './from-snapshot'

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const CSS = readFileSync(path.join(ROOT, 'packages/ui/src/iso-grid/styles.css'), 'utf8')
const sample = (): FactorySnapshot => factorySnapshotSchema.parse(JSON.parse(readFileSync(path.join(ROOT, 'packages/contracts/fixtures/factory-snapshot.sample.json'), 'utf8')))
const NOW = Date.parse('2026-11-14T03:24:40Z')

const tile = (id: string, col: number): Tile => ({ id, position: { col, row: 2 }, span: 2, containerId: 'c', style: { color: '#222' } }) as Tile
const links = (extra: Partial<TileLink>, variant: TileLink['variant']) =>
    renderToStaticMarkup(createElement(TileLinks, { tiles: [tile('a', 0), tile('b', 6)], liveLinks: [{ source: 'a', target: 'b', variant, color: '#38bdf8', ...extra }], containers: [], worldOffset: { left: 0, top: 0 }, svgHalfW: 400, svgHalfH: 300 }))
const buddy = (style: object) => renderToStaticMarkup(createElement(TileBuddy, { id: 'x', style: { color: '#444', buddy: true, label: 'X', ...style } as never, width: 100, height: 50, floorOffset: 10 }))

describe('the still state of the iso-grid', () => {
    it('draws a belt or a trace with `still` as a plain line: no slats, no trace light, no head', () => {
        for (const variant of ['belt', 'trace'] as const) {
            const running = links({}, variant)
            expect(running, variant).toContain('iso-trace-trail')
            expect(running, variant).toContain('iso-trace-head')
            const still = links({ still: true }, variant)
            expect(still, variant).not.toContain('iso-trace-trail')
            expect(still, variant).not.toContain('iso-trace-head')
            expect(still, variant).not.toContain('iso-belt-slats')
        }
        expect(links({}, 'belt')).toContain('iso-belt-slats')
        expect(links({ still: true }, 'belt')).toContain('<path')
    })

    it('marks a buddy with `style.still` and stops its blink in the stylesheet; without it nothing changes', () => {
        expect(buddy({ still: true })).toContain('data-buddy-still')
        expect(buddy({})).not.toContain('data-buddy-still')
        expect(CSS).toMatch(/\[data-buddy-still\][^{]*\.iso-buddy-eyes[^{]*\{[^}]*animation:\s*none/)
    })

    it('the live floor sets it: nothing running means every belt is still, while idle coworkers keep their faces animated', () => {
        const s = sample()
        s.jobs = s.jobs.map(j => ({ ...j, state: 'merged' as const }))
        s.holds = []
        s.pools = s.pools.map(p => ({ ...p, coworkers: p.coworkers.map(c => ({ ...c, out: 0 })) }))
        const f = sceneFromSnapshot(s, NOW)
        const belts = f.links.filter(l => l.variant === 'belt')
        expect(belts.length).toBeGreaterThan(0)
        expect(belts.every(l => l.still === true)).toBe(true)
        expect(f.tiles.filter(t => !t.id.startsWith('cab-') && t.id !== 'rejects').some(t => t.style.still === true)).toBe(false)
        expect(f.tiles.find(t => t.id === 'code')!.style.still).not.toBe(true)
        expect(f.tiles.some(t => t.id.includes('-copy-'))).toBe(false)
    })

    it('the live floor lets a working belt and a working coworker move', () => {
        const f = sceneFromSnapshot(sample(), NOW)
        expect(f.links.some(l => l.variant === 'belt' && l.still !== true)).toBe(true)
        expect(f.links.filter(l => l.variant === 'trace').every(l => l.still !== true)).toBe(true)
        expect(f.tiles.find(t => t.id === 'code')!.style.still).not.toBe(true)
        expect(f.tiles.find(t => t.id === 'code-copy-330')).toBeTruthy()
    })
})
