import { luminanceContrast, rgbLuminance } from '@rerun/contracts'
import type { BrandIconTone } from '@rerun/ui/brand-icon'

export type Rgb = readonly [red: number, green: number, blue: number]

export const DARK_ICON_SURFACE: Rgb = [10, 10, 10]
export const LIGHT_ICON_SURFACE: Rgb = [250, 250, 250] // oklch(0.98 0 0), cf. theme.css
export const MIN_GRAPHIC_CONTRAST = 3

// Une encre est « pâle » quand elle est quasi blanche ET quasi grise. Le garde-fou de chroma est
// ce qui distingue un mark blanc, invisible sur fond clair, d'une marque claire mais colorée
// (jaune Mailchimp, cyan Intercom) qui se lit très bien et doit garder ses couleurs.
const PALE_INK_CONTRAST = 1.5
const PALE_INK_CHROMA = 30
const PALE_INK_SHARE = 0.85

export function classifyRgbaPixels(pixels: Uint8Array | Uint8ClampedArray): BrandIconTone {
    const lightLuminance = rgbLuminance(...LIGHT_ICON_SURFACE)
    let luminance = 0
    let paleWeight = 0
    let weight = 0

    for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3] / 255
        if (alpha === 0) continue
        const [red, green, blue] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]] as const
        const pixelLuminance = rgbLuminance(red, green, blue)
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
        if (chroma <= PALE_INK_CHROMA && luminanceContrast(pixelLuminance, lightLuminance) < PALE_INK_CONTRAST) paleWeight += alpha
        luminance += pixelLuminance * alpha
        weight += alpha
    }

    if (weight === 0) return 'color'
    if (luminanceContrast(luminance / weight, rgbLuminance(...DARK_ICON_SURFACE)) < MIN_GRAPHIC_CONTRAST) return 'dark'
    return paleWeight / weight >= PALE_INK_SHARE ? 'light' : 'color'
}

export function isDarkSurface(rgb: Rgb): boolean {
    const luminance = rgbLuminance(...rgb)
    return luminanceContrast(1, luminance) > luminanceContrast(0, luminance)
}
