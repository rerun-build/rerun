// `@rerun/ui` ships without @types/node; the URL relies on Next inlining the literal
// `process.env.NEXT_PUBLIC_SUPABASE_URL` at build time in each consuming app.
declare const process: { env: Record<string, string | undefined> }

export type BannerColor = 'amber' | 'green' | 'blue' | 'purple' | 'pink' | 'red' | 'pastel'

export type BannerForm = 'blob' | 'bloom' | 'knot' | 'crystal' | 'vortex' | 'smoke' | 'crumple'

export type BannerIllustration = {
    file: string
    desc: string
    color: BannerColor
    form: BannerForm
    url: string
}

const BANNER_BUCKET = 'banner-illustrations'

export function bannerUrl(file: string): string {
    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BANNER_BUCKET}/${file}`
}

type BannerEntry = Omit<BannerIllustration, 'url'>

const ENTRIES: readonly BannerEntry[] = [
    { file: 'lime-glass-crumple.webp', desc: 'Bright lime-green glass, crumpled folded sheets', color: 'green', form: 'crumple' },
    { file: 'pastel-holographic-knot.webp', desc: 'Holographic pastel knotted glass ribbons', color: 'pastel', form: 'knot' },
    { file: 'blue-glass-crystal.webp', desc: 'Electric-blue faceted crystalline glass', color: 'blue', form: 'crystal' },
    { file: 'violet-lime-swirl.webp', desc: 'Purple and lime-green swirling glass vortex', color: 'purple', form: 'vortex' },
    { file: 'crimson-fluid-blob.webp', desc: 'Glossy crimson and magenta fluid blob', color: 'red', form: 'blob' },
    { file: 'amber-droplet-blob.webp', desc: 'Amber-orange glass droplets, glossy bulges', color: 'amber', form: 'blob' },
    { file: 'amber-chrome-swirl.webp', desc: 'Orange and black chrome swirls', color: 'amber', form: 'vortex' },
    { file: 'dark-lime-crumple.webp', desc: 'Black glass crumple veined with acid-green', color: 'green', form: 'crumple' },
    { file: 'pastel-iridescent-bloom.webp', desc: 'Holographic pastel iridescent glass bloom', color: 'pastel', form: 'bloom' },
    { file: 'violet-lime-vortex.webp', desc: 'Purple and lime-green glass vortex tunnels', color: 'purple', form: 'vortex' },
    { file: 'lavender-glass-vortex.webp', desc: 'Lavender glass swirling vortex', color: 'purple', form: 'vortex' },
    { file: 'violet-lime-crystal.webp', desc: 'Purple and green crystalline glass chunks', color: 'purple', form: 'crystal' },
    { file: 'pink-swirl-vortex.webp', desc: 'Hot-pink and red glass swirl vortex', color: 'pink', form: 'vortex' },
    { file: 'violet-lime-knot.webp', desc: 'Purple and lime-green knotted torus loops', color: 'purple', form: 'knot' },
    { file: 'lavender-glass-crystal.webp', desc: 'Lavender crystalline faceted glass', color: 'purple', form: 'crystal' },
    { file: 'blue-chrome-knot.webp', desc: 'Blue chrome knotted torus loops', color: 'blue', form: 'knot' },
    { file: 'blue-plasma-smoke.webp', desc: 'Electric-blue plasma smoke over glass', color: 'blue', form: 'smoke' },
    { file: 'violet-iridescent-vortex.webp', desc: 'Purple iridescent swirling vortex', color: 'purple', form: 'vortex' },
    { file: 'dark-lime-knot.webp', desc: 'Black glass knots glowing acid-green', color: 'green', form: 'knot' },
    { file: 'pastel-holographic-vortex.webp', desc: 'Pastel holographic swirl vortex', color: 'pastel', form: 'vortex' },
    { file: 'blue-liquid-ripple.webp', desc: 'Iridescent blue rippled liquid glass', color: 'blue', form: 'blob' },
    { file: 'blue-glass-bloom.webp', desc: 'Cobalt-blue glass ruffled petals bloom', color: 'blue', form: 'bloom' },
    { file: 'blue-chrome-vortex.webp', desc: 'Blue chrome swirling glass vortex', color: 'blue', form: 'vortex' },
    { file: 'pastel-holographic-smoke.webp', desc: 'Pastel holographic wispy smoke glass', color: 'pastel', form: 'smoke' },
    { file: 'crimson-swirl-vortex.webp', desc: 'Deep-red and magenta swirl vortex', color: 'red', form: 'vortex' },
    { file: 'amethyst-crystal-facets.webp', desc: 'Amethyst-purple crystalline facets', color: 'purple', form: 'crystal' },
    { file: 'violet-iridescent-crumple.webp', desc: 'Purple iridescent crumpled crystal chunks', color: 'purple', form: 'crumple' },
    { file: 'violet-glossy-bloom.webp', desc: 'Glossy purple glass petal bloom', color: 'purple', form: 'bloom' },
    { file: 'violet-lime-fluid-blob.webp', desc: 'Purple and acid-green glossy fluid blobs', color: 'purple', form: 'blob' },
    { file: 'dark-green-swirl-vortex.webp', desc: 'Dark-green and black glossy swirl vortex', color: 'green', form: 'vortex' },
]

export const BANNER_ILLUSTRATIONS: readonly BannerIllustration[] = ENTRIES.map(entry => ({
    ...entry,
    url: bannerUrl(entry.file),
}))

export function getBannerByFile(file: string): BannerIllustration | undefined {
    return BANNER_ILLUSTRATIONS.find(banner => banner.file === file)
}
