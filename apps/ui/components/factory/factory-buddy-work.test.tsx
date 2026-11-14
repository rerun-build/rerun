import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TileBuddy } from '@rerun/ui/iso-grid'

const html = (buddy: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
        createElement(TileBuddy, { id: 'code', style: { color: '#444', buddy, label: 'code' }, width: 120, height: 120, floorOffset: 0, ...extra } as never),
    )
const svg = (s: string) => s.slice(s.indexOf('<svg'))

describe('a working buddy', () => {
    it('keeps its own colour at work when it asks to', () => {
        const s = html({ color: '#7a2cf5', mood: 'working', ownColor: true })
        expect(s).toContain('data-buddy-motion="bob"')
        expect(svg(s)).not.toContain('#f59e0b')
        expect(svg(s)).toContain('#7a2cf5')
    })

    it('is amber at work as on the board when it does not ask', () => {
        const s = html({ color: '#7a2cf5', mood: 'working' })
        expect(s).toContain('data-buddy-motion="bob"')
        expect(svg(s)).toContain('#f59e0b')
    })

    it('rests in its colour with a still body and open to blinking', () => {
        const s = html({ color: '#7a2cf5' })
        expect(s).not.toContain('data-buddy-motion')
        expect(s).toContain('iso-buddy-eyes')
        expect(s).not.toContain('data-buddy-still')
    })

    it('does not bob under reduced motion', () => {
        expect(html({ color: '#7a2cf5', mood: 'working', ownColor: true }, { reducedMotion: true })).not.toContain('data-buddy-motion')
    })
})
