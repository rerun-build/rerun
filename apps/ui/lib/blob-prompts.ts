const COLOR = [
    'vibrant purple with electric acid-green and black accents',
    'deep navy blue glass with cyan and ice-blue highlights',
    'warm orange, amber and deep red gradient',
    'iridescent holographic pastel (pink, mint, lavender)',
    'obsidian black with acid-green internal glow',
    'magenta and crimson smoke gradient',
    'translucent lilac with deep purple core',
    'sunset orange fading to charcoal black',
]

const FORM = [
    'smooth organic flowing blob with twisted folds',
    'rippled flower-like petals curling outward',
    'knotted torus loop, intertwined ribbons',
    'soft melting droplet, single elongated bulge',
    'crumpled folded sheet, sharp creases and waves',
    'faceted crystalline chunk with rounded edges',
    'swirling vortex shell with a hollow center',
    'billowing smoke-like wispy plume',
]

const MATERIAL = [
    'glossy translucent glass with internal refraction',
    'liquid chrome with a glass coating',
    'frosted satin glass, soft subsurface scattering',
    'polished resin with deep gloss reflections',
    'iridescent oil-slick film over clear glass',
    'wet jelly-like gel, high specular sheen',
]

const LIGHT = [
    'soft studio lighting, gentle gradient falloff',
    'high-key bright lighting, crisp highlights',
    'dramatic rim light with deep contrast',
    'diffuse ambient glow, no harsh shadows',
    'colored gel lighting reflecting on the surface',
]

const BACKGROUND = [
    'pure white background',
    'soft off-white seamless background',
    'light grey gradient background',
    'clean flat white background',
]

const RENDER = [
    'octane render, product render style, ultra high detail, 8k',
    'cinema 4d redshift render, photoreal, 8k',
    'blender cycles render, hyper-detailed, sharp focus',
    'unreal engine 5 render, ray-traced reflections, 8k',
]

function pick(options: readonly string[]): string {
    return options[Math.floor(Math.random() * options.length)]
}

export function randomBlobPrompt(): string {
    return [
        'A single abstract 3D fluid blob shape,',
        pick(MATERIAL) + ',',
        'in ' + pick(COLOR) + ',',
        pick(FORM) + ',',
        'high-gloss reflective surface,',
        pick(LIGHT) + ',',
        'floating centered on a ' + pick(BACKGROUND) + ',',
        pick(RENDER) + ',',
        'iridescent highlights,',
        'no shadow, no drop shadow, no contact shadow, no ground reflection',
    ].join(' ')
}

export function randomBlobPrompts(n: number): string[] {
    const seen = new Set<string>()
    let guard = 0
    while (seen.size < n && guard < n * 30) {
        guard++
        seen.add(randomBlobPrompt())
    }
    return [...seen]
}
