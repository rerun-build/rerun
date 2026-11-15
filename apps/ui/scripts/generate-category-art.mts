import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fal } from '@fal-ai/client'
import sharp from 'sharp'
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@rerun/contracts'

const MODEL = 'openai/gpt-image-2'
const WIDTH = 480
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'categories')

type Subject = {
    noun: string
    hero: string
    satellites: string
    tilt: string
    dense: string
    sparse: string
    people?: string
}

const SUBJECTS: Record<TemplateCategory, Subject> = {
    agencies: {
        noun: 'megaphone',
        hero: 'a megaphone — a plain flared cone with a short handle, reduced to its bare silhouette, no grille, no switch, no detail',
        satellites: 'a light bulb, a rising line chart, a target with concentric rings, a heart-shaped like bubble, a triangular pennant flag',
        tilt: 'tilted in a three-quarter view, angled up and to the left',
        dense: 'lower right',
        sparse: 'upper left',
    },
    ecommerce: {
        noun: 'bag',
        hero: 'a shopping bag — a plain trapezoid body with two rounded loop handles on top, reduced to its bare silhouette, no print, no pattern, no detail',
        satellites: 'a shopping cart, a price tag, a sealed cardboard box, a barcode block, a receipt strip',
        tilt: 'tilted in a three-quarter view, rotated slightly to the right',
        dense: 'upper right',
        sparse: 'lower left',
    },
    saas: {
        noun: 'stack',
        hero: 'three rounded rectangular slabs stacked and offset from one another like layers, reduced to their bare silhouette, no screens, no icons, no detail',
        satellites: 'a cloud, a toggle switch, a browser window with a title bar, a two-prong plug, a semicircular gauge',
        tilt: 'tilted in a three-quarter view, leaning back and to the left',
        dense: 'lower left',
        sparse: 'upper right',
    },
    sales: {
        noun: 'arrow',
        hero: 'a thick arrow climbing diagonally upward, a single bold shaft with a solid triangular head, reduced to its bare silhouette, no shading marks, no detail',
        satellites: 'a target with a dart in it, a rising bar chart, a circular percentage badge, an envelope, a handset phone',
        tilt: 'tilted in a three-quarter view, rotated to the right and seen slightly from below',
        dense: 'upper left',
        sparse: 'lower right',
    },
    recruiting: {
        noun: 'figure',
        hero: 'a head-and-shoulders person pictogram — a plain circle for the head above a rounded shoulder shape — with a bold plus sign beside it, a flat abstract symbol reduced to its bare silhouette, no face, no features, no detail',
        satellites: 'a resume sheet with lines, a magnifying glass, a star badge, an envelope, a calendar page',
        tilt: 'tilted in a three-quarter view, rotated to the left and seen slightly from above',
        dense: 'lower right',
        sparse: 'upper left',
        people: 'no photographic people, the human form appears only as a flat abstract pictogram glyph',
    },
    'real-estate': {
        noun: 'house',
        hero: 'a gable house — a plain square body under a triangular pitched roof, reduced to its bare silhouette, no door, no windows, no detail',
        satellites: 'a key, a location map pin, a door, a "for sale" yard sign, a key ring with two keys',
        tilt: 'tilted in a three-quarter view, rotated to the right and tipped slightly forward',
        dense: 'upper left',
        sparse: 'lower right',
    },
    legal: {
        noun: 'balance',
        hero: 'a two-pan balance scale — a vertical post, a horizontal beam and two shallow pans hanging from it, reduced to its bare silhouette, no chains detail, no engraving',
        satellites: 'a judge gavel, a rolled sealed scroll, a shield, a paper clip, a round stamp',
        tilt: 'tilted in a three-quarter view, rotated to the left and seen slightly from below',
        dense: 'lower left',
        sparse: 'upper right',
    },
    creators: {
        noun: 'clapperboard',
        hero: 'a film clapperboard — a plain rectangular slate with a hinged striped bar on top, reduced to its bare silhouette, no writing, no numbers, no detail',
        satellites: 'a triangular play button, a microphone, a camera lens aperture, a heart-shaped like bubble, an empty thumbnail frame',
        tilt: 'tilted in a three-quarter view, rotated to the right and tipped back',
        dense: 'upper right',
        sparse: 'lower left',
    },
    productivity: {
        noun: 'checkbox',
        hero: 'a checked box — a rounded square with a bold check mark that overflows past its top-right corner, reduced to its bare silhouette, no detail',
        satellites: 'a round clock, an hourglass, a bulleted list block, a calendar page, a square sticky note',
        tilt: 'tilted in a three-quarter view, rotated to the left and seen slightly from above',
        dense: 'lower right',
        sparse: 'upper left',
    },
    other: {
        noun: 'glyph',
        hero: 'a horizontal ellipsis — three bold dots in a row, sitting inside a rounded square frame, reduced to their bare silhouette, no markings, no detail',
        satellites: 'a sphere, a triangular prism, a hexagonal plate, a torus ring, a small cube',
        tilt: 'tilted in a three-quarter view, rotated to the right and tipped forward',
        dense: 'upper left',
        sparse: 'lower right',
    },
}

function buildPrompt(s: Subject): string {
    const n = s.noun
    return [
        `3D render, Octane-style, dark ambient. A single extruded pictogram of ${s.hero} — carved from a solid block of thick optically clear glass with a very high index of refraction, massive and deeply extruded with generously rounded bevelled edges and a thick visible side wall.`,
        `The shape is a filled solid volume, never an outline: its interior is not empty, soft internal reflections and blue streaks travel through the mass and the back edges are visible through the body, displaced and doubled by refraction.`,
        `The glass is not emissive and does not glow, it only transmits and refracts light.`,
        `Its body is tinted across a range: near-black indigo through the thickest mass, electric blue #3B5BFF where the glass thins toward the bevels, violet #9a4bff only where the light gathers, and the brightest points are white-cyan, never violet.`,
        `Strong chromatic dispersion: every bevel and every edge throws thin one-pixel iridescent fringes of cyan, magenta and amber that hug the contour.`,
        `The ${n} is ${s.tilt}, razor sharp.`,
        `Scattered behind it float five smaller extruded pictograms from the same world — ${s.satellites} — carved from the exact same glass, tilted at all different angles, at wildly uneven scales, one very large and cropped by the frame while the others sit small and far back, clustered into two uneven groups, one dense in the ${s.dense} and one sparse in the ${s.sparse}, leaving large empty black areas elsewhere, never arranged in a ring around the ${n}.`,
        `They are heavily out of focus, blurrier and dimmer toward the edges of the frame, three stops darker than the ${n} so that none of them catches the eye before it, reading as texture rather than as a second subject, and a halo of pure black separates them from the ${n} silhouette.`,
        `Heavy shallow depth of field: only the ${n} is razor sharp.`,
        `No floor, no horizon, no environment, no studio reflections, nothing beneath the objects, no ground glow, no contact shadow: everything floats in absolute darkness on a pure black #000000 background.`,
        `Ultra clean, glossy, high contrast, premium 3D.`,
        `No neon, no glowing lines, no text, no logos, ${s.people ?? 'no people'}.`,
    ].join(' ')
}

async function render(category: TemplateCategory) {
    const result = await fal.subscribe(MODEL, {
        input: { prompt: buildPrompt(SUBJECTS[category]), image_size: 'landscape_16_9', quality: 'high', num_images: 1, output_format: 'png' },
    })
    const url = (result.data as { images?: { url?: string }[] })?.images?.[0]?.url
    if (!url) throw new Error(`${category}: no image returned`)

    const png = Buffer.from(await (await fetch(url)).arrayBuffer())
    const webp = await sharp(png).resize({ width: WIDTH }).webp({ quality: 82, effort: 6 }).toBuffer()
    await writeFile(join(OUT_DIR, `${category}.webp`), webp)
    console.log(`${category}.webp ${Math.round(webp.byteLength / 1024)} kB`)
}

function isCategory(value: string): value is TemplateCategory {
    return (TEMPLATE_CATEGORIES as readonly string[]).includes(value)
}

const asked = process.argv.slice(2)
for (const slug of asked) if (!isCategory(slug)) throw new Error(`unknown category: ${slug}`)

if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not configured')
fal.config({ credentials: process.env.FAL_KEY })
await mkdir(OUT_DIR, { recursive: true })

const targets = asked.length > 0 ? (asked as TemplateCategory[]) : TEMPLATE_CATEGORIES.filter(category => !existsSync(join(OUT_DIR, `${category}.webp`)))
if (targets.length === 0) {
    console.log('nothing to render, pass a slug to force one')
} else {
    await Promise.all(targets.map(render))
}
