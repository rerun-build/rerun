import type { BrandIconTone } from '@moldwright/ui/brand-icon'

export type Rgb = readonly [red: number, green: number, blue: number]

export const DARK_ICON_SURFACE: Rgb = [10, 10, 10]
export const LIGHT_ICON_SURFACE: Rgb = [250, 250, 250]
export const MIN_GRAPHIC_CONTRAST = 3

const PALE_INK_CONTRAST = 1.5
const PALE_INK_CHROMA = 30
const PALE_INK_SHARE = 0.85

function linearChannel(channel: number): number {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance([red, green, blue]: Rgb): number {
    return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue)
}

export function contrastRatio(first: number, second: number): number {
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

export function classifyRgbaPixels(pixels: Uint8Array | Uint8ClampedArray): BrandIconTone {
    const lightLuminance = relativeLuminance(LIGHT_ICON_SURFACE)
    let luminance = 0
    let paleWeight = 0
    let weight = 0

    for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3] / 255
        if (alpha === 0) continue
        const [red, green, blue] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]] as const
        const pixelLuminance = relativeLuminance([red, green, blue])
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
        if (chroma <= PALE_INK_CHROMA && contrastRatio(pixelLuminance, lightLuminance) < PALE_INK_CONTRAST) paleWeight += alpha
        luminance += pixelLuminance * alpha
        weight += alpha
    }

    if (weight === 0) return 'color'
    if (contrastRatio(luminance / weight, relativeLuminance(DARK_ICON_SURFACE)) < MIN_GRAPHIC_CONTRAST) return 'dark'
    return paleWeight / weight >= PALE_INK_SHARE ? 'light' : 'color'
}

export function isDarkSurface(rgb: Rgb): boolean {
    const luminance = relativeLuminance(rgb)
    return contrastRatio(1, luminance) > contrastRatio(0, luminance)
}
