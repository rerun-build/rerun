export type Oklch = { l: number; c: number; h: number }

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

// `#rrggbb` in lower case, or null for anything that is not a 3 or 6 digit hex color.
export function normalizeHex(value: string | null | undefined): string | null {
    const digits = value?.trim().match(HEX)?.[1].toLowerCase()
    if (!digits) return null
    return `#${digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits}`
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

function linearChannels(hex: string): [number, number, number] {
    const channel = (at: number) => toLinear(parseInt(hex.slice(at, at + 2), 16) / 255)
    return [channel(1), channel(3), channel(5)]
}

const luminanceOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// WCAG relative luminance of a color given as its red, green and blue from 0 to 255.
export function rgbLuminance(red: number, green: number, blue: number): number {
    return luminanceOf(toLinear(red / 255), toLinear(green / 255), toLinear(blue / 255))
}

// WCAG contrast ratio of two relative luminances, from 1 to 21.
export function luminanceContrast(first: number, second: number): number {
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

// WCAG contrast ratio of two `#rrggbb` colors, from 1 to 21.
export function hexContrast(a: string, b: string): number {
    return luminanceContrast(luminanceOf(...linearChannels(a)), luminanceOf(...linearChannels(b)))
}

export function hexToOklch(hex: string): Oklch {
    const [r, g, b] = linearChannels(hex)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return { l: lightness, c: Math.hypot(a, bAxis), h: ((Math.atan2(bAxis, a) * 180) / Math.PI + 360) % 360 }
}

function oklchToLinear({ l, c, h }: Oklch): number[] {
    const a = c * Math.cos((h * Math.PI) / 180)
    const b = c * Math.sin((h * Math.PI) / 180)
    const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    return [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S]
}

const GAMUT_MARGIN = 0.0005

// Keeps lightness and hue, gives up chroma until sRGB can show the color.
export function oklchToHex(color: Oklch): string {
    let c = color.c
    let linear = oklchToLinear(color)
    while (c > 0 && linear.some(v => v < -GAMUT_MARGIN || v > 1 + GAMUT_MARGIN)) {
        c = Math.max(0, c - 0.004)
        linear = oklchToLinear({ ...color, c })
    }
    const channels = linear.map(v => Math.round(toGamma(clamp(v, 0, 1)) * 255).toString(16).padStart(2, '0'))
    return `#${channels.join('')}`
}

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export const hueDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
