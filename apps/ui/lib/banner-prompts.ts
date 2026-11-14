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
    'smooth organic flowing blobs with twisted folds',
    'rippled flower-like petals curling outward',
    'knotted torus loops, intertwined ribbons',
    'soft melting droplets, elongated bulges',
    'crumpled folded sheets, sharp creases and waves',
    'faceted crystalline chunks with rounded edges',
    'swirling vortex shells with hollow centers',
    'billowing smoke-like wispy plumes',
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

const RENDER = [
    'octane render, product render style, ultra high detail, 8k',
    'cinema 4d redshift render, photoreal, 8k',
    'blender cycles render, hyper-detailed, sharp focus',
    'unreal engine 5 render, ray-traced reflections, 8k',
]

function pick(options: readonly string[]): string {
    return options[Math.floor(Math.random() * options.length)]
}

export function randomBannerPrompt(): string {
    return [
        'A wide panoramic hero banner, extreme macro close-up of an abstract 3D fluid glass texture,',
        pick(MATERIAL) + ',',
        'in ' + pick(COLOR) + ',',
        pick(FORM) + ',',
        'the texture completely fills the entire frame edge to edge, full-bleed all-over composition,',
        'seamless dense pattern spanning the whole width and height, no empty background, no negative space,',
        'high-gloss reflective surfaces, iridescent highlights,',
        pick(LIGHT) + ',',
        pick(RENDER) + ',',
        'ultra-wide 16:9, tightly cropped so shapes bleed off all four edges, no text, no logo, no watermark',
    ].join(' ')
}

export function randomBannerPrompts(n: number): string[] {
    const seen = new Set<string>()
    let guard = 0
    while (seen.size < n && guard < n * 30) {
        guard++
        seen.add(randomBannerPrompt())
    }
    return [...seen]
}
