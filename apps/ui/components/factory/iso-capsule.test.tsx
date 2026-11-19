import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TileBuddy, agentTileStyle } from '@moldwright/ui/iso-grid'

const draw = (style: object) => renderToStaticMarkup(createElement(TileBuddy, { id: 'Delegator', style: style as never, width: 160, height: 80, floorOffset: 0 }))
const idle = { color: '#444', buddy: { eyes: 'round' }, label: 'Delegator' }
const working = { ...idle, shimmer: true, glow: 'rgba(245, 158, 11, 0.6)' }
const held = { ...agentTileStyle('waiting_human', 'Delegator') }
const capsule = (style: object) => draw({ ...style, shape: 'capsule' })

describe('the faceless capsule tile', () => {
    it('draws a faceless capsule for shape capsule', () => {
        expect(draw(idle)).toContain('iso-buddy-eyes')
        const markup = capsule(idle)
        expect(markup).toContain('data-capsule')
        expect(markup).not.toContain('iso-buddy-eyes')
        expect(markup).not.toContain('iso-buddy-mouth')
    })

    it('is unlit when idle and glows only when it works', () => {
        const rest = capsule(idle)
        expect(rest).not.toContain('data-lit')
        expect(rest).not.toContain('data-buddy-motion')
        const busy = capsule(working)
        expect(busy).toContain('data-lit')
        expect(busy).toContain('drop-shadow')
        expect(busy).not.toContain('data-buddy-motion')
    })

    it('is red under a hold', () => {
        const markup = capsule(held)
        expect(markup).toContain('data-held')
        expect(markup).toContain('#ef4444')
        expect(markup).not.toContain('data-buddy-motion')
    })

    it('is solid', () => {
        for (const style of [idle, working, held]) {
            const art = capsule(style).match(/<svg[\s\S]*<\/svg>/)?.[0] ?? ''
            expect(art).toContain('data-capsule')
            expect(art).not.toMatch(/opacity="0?\.\d/)
            expect(art).not.toContain('fill-opacity')
            expect(art).not.toContain('rgba(')
        }
    })

    it('leaves a buddy without the shape as it is', () => {
        expect(draw(idle)).not.toContain('data-capsule')
    })

    it('renders each mood once', () => {
        for (const style of [idle, working, held]) {
            const markup = capsule(style)
            expect(markup.startsWith('<div')).toBe(true)
            expect(markup.match(/data-capsule/g)).toHaveLength(1)
        }
    })
})
