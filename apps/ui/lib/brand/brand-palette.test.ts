import { brandPalette, hexContrast, normalizeHex, type BrandPaletteSide } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

const READABLE = 4.5
const VISIBLE = 3
const PAGES = { light: ['#fafafa', '#ffffff'], dark: ['#0a0a0a', '#171717'] } as const
const BADGE_TINT = 0.1
const THEMES = ['light', 'dark'] as const

const STEPS = Array.from({ length: 18 }, (_, step) => Math.round((step * 255) / 17))
const hexByte = (value: number) => value.toString(16).padStart(2, '0')
const SWEEP = STEPS.flatMap(r => STEPS.flatMap(g => STEPS.map(b => `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`)))

const NEUTRAL = brandPalette(null)

function badgeSurface(brand: string, page: string): string {
    const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
    return `#${[1, 3, 5].map(at => hexByte(Math.round(channel(brand, at) * BADGE_TINT + channel(page, at) * (1 - BADGE_TINT)))).join('')}`
}

const signalsOf = ({ brand, brandInk, brandText, brandTint }: BrandPaletteSide) => ({ brand, brandInk, brandText, brandTint })

function brokenRules(color: string): string[] {
    const palette = brandPalette(color)
    const broken: string[] = []
    const check = (holds: boolean, rule: string) => {
        if (!holds) broken.push(`${color}: ${rule}`)
    }
    for (const theme of THEMES) {
        const side = palette[theme]
        for (const [name, value] of Object.entries(side)) check(/^#[0-9a-f]{6}$/.test(value), `${theme} ${name} is ${value}`)
        check(hexContrast(side.bubbleInk, side.bubble) >= READABLE, `${theme} ink on the bubble`)
        check(hexContrast(side.brandInk, side.brand) >= READABLE, `${theme} ink on a signal`)
        for (const page of PAGES[theme]) {
            check(hexContrast(side.brandText, page) >= READABLE, `${theme} text on ${page}`)
            check(hexContrast(side.brandText, badgeSurface(side.brand, page)) >= READABLE, `${theme} text of a badge on ${page}`)
            check(hexContrast(side.brand, page) >= VISIBLE, `${theme} signal on ${page}`)
        }
        if (palette.guarded) check(JSON.stringify(signalsOf(side)) === JSON.stringify(signalsOf(NEUTRAL[theme])), `${theme} signals are not neutral`)
        if (palette.neutral) check(JSON.stringify(side) === JSON.stringify(NEUTRAL[theme]), `${theme} is not the neutral palette`)
    }
    check(JSON.stringify(brandPalette(color)) === JSON.stringify(palette), 'is not deterministic')
    return broken
}

describe('normalizeHex', () => {
    it.each([
        ['#1668e3', '#1668e3'],
        ['1668E3', '#1668e3'],
        ['#ABC', '#aabbcc'],
        ['abc', '#aabbcc'],
        [' #fff ', '#ffffff'],
    ])('reads %s', (value, expected) => expect(normalizeHex(value)).toBe(expected))

    it.each(['', '#', '#12', '#1234', '#12345', '#1234567', 'red', 'rgb(0,0,0)', '#fffffg', '#fff;', '#fff\n}', '##fff', null, undefined])('refuses %j', value => {
        expect(normalizeHex(value)).toBeNull()
    })
})

describe('brandPalette', () => {
    it('keeps every rule on 5832 colors, in both themes', () => {
        expect(SWEEP).toHaveLength(5832)
        expect(SWEEP.flatMap(brokenRules)).toEqual([])
    })

    it('protects about a third of the colors', () => {
        const share = SWEEP.filter(color => brandPalette(color).guarded).length / SWEEP.length
        expect(share).toBeGreaterThan(0.25)
        expect(share).toBeLessThan(0.36)
    })

    it('is neutral without a color, with an invalid one, with black and with white', () => {
        for (const color of [null, '', 'blue', '#12345', '#000', '#fff', '#0a0a0a', '#fafafa']) expect(brandPalette(color)).toEqual(NEUTRAL)
        expect(NEUTRAL).toMatchObject({ neutral: true, guarded: null, light: { bubble: '#171717', bubbleInk: '#ffffff' }, dark: { bubble: '#e5e5e5', bubbleInk: '#0a0a0a' } })
    })

    it('reads the same color however it is written', () => {
        for (const color of ['1668E3', '#1668E3', ' #1668e3']) expect(brandPalette(color)).toEqual(brandPalette('#1668e3'))
        expect(brandPalette('#0cf')).toEqual(brandPalette('#00ccff'))
    })

    it.each([
        ['#1668e3', null],
        ['#0f766e', null],
        ['#ffd500', 'waiting'],
        ['#e11d2e', 'error'],
        ['#7cff4f', 'running'],
        ['#f8d7e3', null],
        ['#0b1b4d', null],
        ['#f97316', 'waiting'],
        ['#6b7280', null],
        ['#4d34f7', null],
    ])('%s is protected as %s, its hue stays on the bubble', (color, guarded) => {
        expect(brokenRules(color)).toEqual([])
        const palette = brandPalette(color)
        expect(palette.guarded).toBe(guarded)
        expect(palette.neutral).toBe(false)
        expect(palette.light.bubble).not.toBe(NEUTRAL.light.bubble)
        expect(palette.light.brand === NEUTRAL.light.brand).toBe(guarded !== null)
    })

    it('leaves an easy color as it is on the bubble, and writes in black on a bright one', () => {
        expect(brandPalette('#1668e3').light).toMatchObject({ bubble: '#1668e3', bubbleInk: '#ffffff' })
        expect(brandPalette('#ffd500').light.bubbleInk).toBe('#0a0a0a')
    })
})
