import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TileBuddy, buddyEyes, buddyMouth } from '@moldwright/ui/iso-grid'

const html = (buddy: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
        createElement(TileBuddy, { id: 'code', style: { color: '#444', buddy, label: 'code' }, width: 120, height: 120, floorOffset: 0, ...extra } as never),
    )
const pool = (s: string) => s.slice(0, s.indexOf('<svg'))
const poolPercent = (s: string) => Number(/color-mix\(in srgb, [^ ]+ (\d+)%/.exec(pool(s))?.[1])

describe('the floor glow of a buddy', () => {
    it('lights the floor in its own colour at work', () => {
        const s = html({ color: '#7a2cf5', mood: 'working', ownColor: true })
        expect(s).not.toContain('#f59e0b')
        expect(/<div class="iso-buddy-pool[^>]*>/.exec(s)?.[0]).toContain('#7a2cf5')
    })

    it('lights the floor amber at work when it does not ask', () => {
        const s = html({ color: '#7a2cf5', mood: 'working' })
        expect(/<div class="iso-buddy-pool[^>]*>/.exec(s)?.[0]).toContain('#f59e0b')
    })

    it('lights the floor less at rest than at work', () => {
        const rest = poolPercent(html({ color: '#7a2cf5' }))
        const work = poolPercent(html({ color: '#7a2cf5', mood: 'working', ownColor: true }))
        expect(rest).toBe(32)
        expect(work).toBe(55)
        expect(rest).toBeLessThan(work)
    })

    it('exports the two face helpers', () => {
        expect(typeof buddyEyes).toBe('function')
        expect(typeof buddyMouth).toBe('function')
        expect(typeof buddyEyes('code-1', {})).toBe('string')
        expect(typeof buddyMouth('code-1', {})).toBe('string')
    })
})

describe('the stance of a buddy', () => {
    it('stands taller while it works in its own colour, flat at rest', () => {
        expect(html({ color: '#7a2cf5', mood: 'working', ownColor: true })).toContain('data-buddy-stretched')
        expect(html({ color: '#7a2cf5' })).not.toContain('data-buddy-stretched')
    })

    it('does not stretch a working buddy that keeps the board amber', () => {
        expect(html({ mood: 'working' })).not.toContain('data-buddy-stretched')
    })

    it('still stretches a selected resting buddy, and never a ghost', () => {
        expect(html({ color: '#7a2cf5' }, { stretched: true })).toContain('data-buddy-stretched')
        expect(html({ color: '#7a2cf5', mood: 'working', ownColor: true }, { ghost: { valid: true } })).not.toContain('data-buddy-stretched')
    })
})
