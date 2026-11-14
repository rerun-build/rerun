import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TileBuddy, type Tile } from '@rerun/ui/iso-grid'
import { factoryScene } from './factory-scene'

const TIMES = [0, 6_000, 9_000, 25_000, 70_000]
const COLOURS: Record<string, string> = { code: '#4d34f7', LARRY: '#0ea5e9', LINUS: '#10b981', search: '#f472b6', DIETER: '#f59e0b', BRUCE: '#64748b' }
const who = (t: Tile) => (t.ariaLabel ?? '').replace(/, a copy$/, '')
const tilesAt = (t: number) => factoryScene(t, 0).tiles.filter(x => x.id !== 'Delegator')
const style = (t: Tile) => t.style as { glow?: string; color?: string; buddy?: { mood?: string; ownColor?: boolean; color?: string } }
const working = (t: number) => tilesAt(t).filter(x => style(x).buddy?.mood === 'working')
const markup = (t: Tile) => renderToStaticMarkup(createElement(TileBuddy, { id: t.id, style: t.style as never, width: 120, height: 120, floorOffset: 0 }))

describe('factory floor looks', () => {
    it('has no gold working coworker, copies included', () => {
        for (const t of TIMES) for (const x of tilesAt(t)) {
            expect(style(x).glow, `${x.id} at ${t}`).not.toBe('rgba(245, 158, 11, 0.6)')
            expect(style(x).color, `${x.id} at ${t}`).not.toBe('#f59e0b')
        }
    })
    it('a working coworker bobs in its own colour', () => {
        for (const t of TIMES) for (const x of working(t)) {
            const c = COLOURS[who(x)]
            expect(style(x).buddy?.ownColor).toBe(true)
            expect(style(x).buddy?.color).toBe(c)
            expect(style(x).glow).toBe(`color-mix(in srgb, ${c} 60%, transparent)`)
        }
        expect(working(9_000).length).toBeGreaterThan(0)
    })
    it('a working coworker stands taller, the loader does not', () => {
        const w = working(9_000)
        expect(w.length).toBeGreaterThan(0)
        for (const x of w) expect(markup(x)).toContain('data-buddy-stretched')
        const loader = factoryScene(9_000, 0).tiles.find(x => x.id === 'Delegator')!
        expect(markup(loader)).not.toContain('data-buddy-stretched')
    })
    it('rests with the default faint glow, no mood and no stretch', () => {
        for (const t of TIMES) for (const x of tilesAt(t)) {
            if (!style(x).buddy || style(x).buddy?.mood === 'working') continue
            expect(style(x).glow).toBe('var(--iso-tile-idle-glow)')
            expect(style(x).buddy?.mood).toBeUndefined()
        }
    })
    it('keeps the loader as it is', () => {
        for (const t of TIMES) {
            const l = factoryScene(t, 0).tiles.find(x => x.id === 'Delegator')
            expect(l).toBeTruthy()
            expect((l!.style as { shape?: string }).shape).toBe('capsule')
        }
    })
})
