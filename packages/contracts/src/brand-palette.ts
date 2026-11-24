import { clamp, hexContrast, hexToOklch, hueDistance, normalizeHex, oklchToHex, type Oklch } from './color.js'

// What a hue already says in the app, which a brand must not be mistaken for.
export type GuardedStatus = 'error' | 'waiting' | 'running'

// `brand` draws the signals (dots, bars, rings) and `brandInk` what is written on one, `brandText`
// sits on the page, `brandTint` is the light of the beams, `bubbleInk` is written on the user's bubble.
export type BrandPaletteSide = { brand: string; brandInk: string; brandText: string; brandTint: string; bubble: string; bubbleInk: string }

export type BrandPalette = {
    light: BrandPaletteSide
    dark: BrandPaletteSide
    // The status the color looks like: it stays on the bubble, and the signals are neutral.
    guarded: GuardedStatus | null
    // No hue at all, on the bubble either.
    neutral: boolean
}

type Fill = { fill: string; ink: string }
type Shades = Fill & { text: string; tint: string }
type ThemedShades = { light: Shades; dark: Shades }

const LIGHT_PAGE = '#fafafa'
const DARK_CARD = '#171717'
const WHITE = '#ffffff'
const BLACK = '#0a0a0a'

const READABLE = 4.5
// A badge writes the text on a tint of the brand, which takes up to a sixth of the contrast away.
const READABLE_ON_BADGE = 5.5
const VISIBLE = 3

const GREY_CHROMA = 0.03
const STATUS_CHROMA = 0.1

const NEUTRAL: ThemedShades = {
    light: { fill: '#171717', ink: WHITE, text: '#171717', tint: '#8a8a8a' },
    dark: { fill: '#e5e5e5', ink: BLACK, text: '#e5e5e5', tint: WHITE },
}

const STATUS_HUES: { status: GuardedStatus; hue: number; reach: number }[] = [
    { status: 'error', hue: 27, reach: 14 },
    { status: 'waiting', hue: 68, reach: 30 },
    { status: 'running', hue: 155, reach: 22 },
]

function statusOf({ c, h }: Oklch): GuardedStatus | null {
    if (c < STATUS_CHROMA) return null
    return STATUS_HUES.find(({ hue, reach }) => hueDistance(hue, h) <= reach)?.status ?? null
}

function shiftUntil(color: Oklch, step: number, passes: (hex: string) => boolean): string {
    let l = color.l
    let hex = oklchToHex({ ...color, l })
    while (!passes(hex) && l > 0 && l < 1) {
        l = clamp(l + step, 0, 1)
        hex = oklchToHex({ ...color, l })
    }
    return hex
}

// White stays on the color when a small darkening is enough, else the ink flips to black: darkening
// a yellow until white reads on it turns it into an olive nobody picked.
const WHITE_BUDGET = 0.09

function fillOf(source: Oklch, low: number, high: number): Fill {
    const color = { ...source, l: clamp(source.l, low, high), c: Math.min(source.c, 0.24) }
    const darkened = shiftUntil(color, -0.01, hex => hexContrast(hex, WHITE) >= READABLE)
    const plain = oklchToHex(color)
    if (color.l - hexToOklch(darkened).l <= WHITE_BUDGET || hexContrast(plain, BLACK) < READABLE) return { fill: darkened, ink: WHITE }
    return { fill: plain, ink: BLACK }
}

function boundedShades(source: Oklch): ThemedShades {
    const calm = { ...source, c: Math.min(source.c, 0.2) }
    const tintChroma = Math.min(calm.c, 0.13)
    return {
        light: {
            ...fillOf(source, 0.22, 0.84),
            text: shiftUntil(calm, -0.01, hex => hexContrast(hex, LIGHT_PAGE) >= READABLE_ON_BADGE),
            tint: oklchToHex({ ...calm, l: 0.78, c: tintChroma }),
        },
        dark: {
            ...fillOf(source, 0.44, 0.88),
            text: shiftUntil({ ...calm, l: Math.max(calm.l, 0.72) }, 0.01, hex => hexContrast(hex, DARK_CARD) >= READABLE_ON_BADGE),
            tint: oklchToHex({ ...calm, l: 0.82, c: tintChroma }),
        },
    }
}

const inkOn = (fill: string) => (hexContrast(fill, WHITE) >= READABLE ? WHITE : BLACK)

function sideOf(signals: Shades, bubble: Fill, page: string): BrandPaletteSide {
    // A dot or a bar is a few pixels wide: too close to the page, it takes the text's shade.
    const brand = hexContrast(signals.fill, page) >= VISIBLE ? signals.fill : signals.text
    return { brand, brandInk: inkOn(brand), brandText: signals.text, brandTint: signals.tint, bubble: bubble.fill, bubbleInk: bubble.ink }
}

const paletteOf = (signals: ThemedShades, bubble: ThemedShades) => ({ light: sideOf(signals.light, bubble.light, LIGHT_PAGE), dark: sideOf(signals.dark, bubble.dark, DARK_CARD) })

const isBlackOrWhite = ({ l, c }: Oklch) => c < GREY_CHROMA && (l < 0.3 || l > 0.9)

// The palette of an organization's color, readable in both themes whatever the color is.
export function brandPalette(color: string | null): BrandPalette {
    const hex = normalizeHex(color)
    const source = hex ? hexToOklch(hex) : null
    if (!source || isBlackOrWhite(source)) return { ...paletteOf(NEUTRAL, NEUTRAL), guarded: null, neutral: true }
    const guarded = statusOf(source)
    const bounded = boundedShades(source)
    return { ...paletteOf(guarded ? NEUTRAL : bounded, bounded), guarded, neutral: false }
}
