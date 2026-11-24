import { brandPalette, isWhiteLabel, type Brand, type BrandPaletteSide } from '@rerun/contracts'

// `--color-brand` is Tailwind's copy, frozen on the root: redeclared so an island of the other theme
// reads its own side. `--bubble-token` has no default: without it a composer token keeps its hue.
function sideVars({ brand, brandInk, brandText, brandTint, bubble, bubbleInk }: BrandPaletteSide): string {
    const vars = {
        '--brand': brand,
        '--color-brand': brand,
        '--brand-ink': brandInk,
        '--brand-text': brandText,
        '--brand-mark': brandText,
        '--brand-tint': brandTint,
        '--brand-chart': brand,
        '--brand-glow': brand,
        '--bubble': bubble,
        '--bubble-ink': bubbleInk,
        '--bubble-token': bubbleInk,
    }
    return Object.entries(vars)
        .map(([name, value]) => `${name}:${value}`)
        .join(';')
}

// The colors of an organization, laid over the defaults of globals.css whichever is read first. The
// color comes from the database: only what `brandPalette` computed from it is ever written here.
export function brandCss(brand: Brand): string {
    if (!isWhiteLabel(brand)) return ''
    const { light, dark } = brandPalette(brand.color)
    return [
        `html:root,html .light{${sideVars(light)}}`,
        `html:root.dark,html .dark{${sideVars(dark)}}`,
        'html .is-user [data-ink] ::selection{background:color-mix(in srgb,var(--bubble-ink) 25%,transparent);color:var(--bubble-ink)}',
    ].join('')
}
