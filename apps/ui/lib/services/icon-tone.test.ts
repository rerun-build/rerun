import { brandIconToneFromUrl, withBrandIconTone } from '@moldwright/ui/brand-icon'
import { describe, expect, it } from 'vitest'

import { syncTemplateConnectorIconSnapshot } from './brand-icon'
import { analyzeBrandIconTone } from './icon-tone.server'
import { classifyRgbaPixels } from './icon-tone'

function pixel(hex: string, alpha = 255): number[] {
    return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16), alpha]
}

describe('brand icon tone', () => {
    it.each([
        ['GitHub', '#181717'],
        ['Notion', '#000000'],
    ])('classifies the dark %s mark for adaptive whitening', (_name, color) => {
        expect(classifyRgbaPixels(Uint8Array.from(pixel(color)))).toBe('dark')
    })

    it.each([
        ['Stripe', '#635BFF'],
        ['Figma', '#F24E1E'],
    ])('keeps the %s brand color', (_name, color) => {
        expect(classifyRgbaPixels(Uint8Array.from(pixel(color)))).toBe('color')
    })

    it.each([
        ['Canva', '#FFFFFF'],
        ['Deel', '#FAFAFA'],
    ])('classifies the white %s mark for adaptive blackening', (_name, color) => {
        expect(classifyRgbaPixels(Uint8Array.from(pixel(color)))).toBe('light')
    })

    it.each([
        ['Mailchimp', '#FFE01B'],
        ['Intercom', '#6AFDEF'],
    ])('keeps the light but saturated %s mark in color', (_name, color) => {
        expect(classifyRgbaPixels(Uint8Array.from(pixel(color)))).toBe('color')
    })

    it('keeps a mostly colored mark in color even with a white portion', () => {
        const pixels = Uint8Array.from([...pixel('#FFFFFF'), ...pixel('#F24E1E'), ...pixel('#F24E1E')])
        expect(classifyRgbaPixels(pixels)).toBe('color')
    })

    it('ignores fully transparent pixels', () => {
        const pixels = Uint8Array.from([...pixel('#000000', 0), ...pixel('#F24E1E')])
        expect(classifyRgbaPixels(pixels)).toBe('color')
    })

    it('classifies a multicolor mark from all visible pixels', () => {
        const pixels = Uint8Array.from([...pixel('#E01E5A'), ...pixel('#36C5F0'), ...pixel('#2EB67D'), ...pixel('#ECB22E')])
        expect(classifyRgbaPixels(pixels)).toBe('color')
    })

    it('rasterizes SVG assets before classifying them', async () => {
        const github = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#181717" d="M0 0h10v10H0z"/></svg>')
        const figma = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#F24E1E" d="M0 0h10v10H0z"/></svg>')
        const canva = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#FFFFFF" d="M0 0h10v10H0z"/></svg>')
        await expect(analyzeBrandIconTone(github)).resolves.toBe('dark')
        await expect(analyzeBrandIconTone(figma)).resolves.toBe('color')
        await expect(analyzeBrandIconTone(canva)).resolves.toBe('light')
    })

    it('round-trips tone markers without dropping cache-busting parameters', () => {
        const original = 'https://example.com/github.svg?v=123'
        const dark = withBrandIconTone(original, 'dark')
        expect(dark).toBe('https://example.com/github.svg?v=123&tone=dark')
        expect(brandIconToneFromUrl(dark)).toBe('dark')
        expect(withBrandIconTone(dark, 'color')).toBe(original)

        const light = withBrandIconTone(original, 'light')
        expect(light).toBe('https://example.com/github.svg?v=123&tone=light')
        expect(brandIconToneFromUrl(light)).toBe('light')
        expect(withBrandIconTone(light, 'dark')).toBe(dark)
    })

    it('synchronizes denormalized template connector icons without changing unknown entries', () => {
        const original = [
            { slug: 'apollo', name: 'Apollo', icon: 'https://example.com/apollo.png?v=1' },
            { slug: 'custom', name: 'Custom', icon: null, extra: true },
        ]
        const result = syncTemplateConnectorIconSnapshot(original, new Map([['apollo', 'https://example.com/apollo.png?v=1&tone=dark']]))

        expect(result).toEqual({
            changed: true,
            connectors: [
                { slug: 'apollo', name: 'Apollo', icon: 'https://example.com/apollo.png?v=1&tone=dark' },
                original[1],
            ],
        })
    })
})
