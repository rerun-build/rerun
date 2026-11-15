import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fal } from '@fal-ai/client'
import sharp from 'sharp'

const MODEL = 'openai/gpt-image-2'

export const WIDTH = 1040
export const HEIGHT = 480
const FADE = 170
const CARD_SURFACE = '#171717'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW_DIR = join(ROOT, '..', '..', '.context', 'images')

export type GlassSubject = {
    noun: string
    hero: string
    satellites: string
    tilt: string
    dense: string
    sparse: string
    people?: string
}

export function buildPrompt(s: GlassSubject): string {
    const n = s.noun
    return [
        `3D render, Octane-style, dark ambient. A single extruded pictogram of ${s.hero} — carved from a solid block of thick optically clear glass with a very high index of refraction, massive and deeply extruded with generously rounded bevelled edges and a thick visible side wall.`,
        `The shape is a filled solid volume, never an outline: its interior is not empty, soft internal reflections and blue streaks travel through the mass and the back edges are visible through the body, displaced and doubled by refraction.`,
        `The glass is not emissive and does not glow, it only transmits and refracts light.`,
        `Its body is tinted across a range: near-black indigo through the thickest mass, electric blue #3B5BFF where the glass thins toward the bevels, violet #9a4bff only where the light gathers, and the brightest points are white-cyan, never violet.`,
        `Strong chromatic dispersion: every bevel and every edge throws thin one-pixel iridescent fringes of cyan, magenta and amber that hug the contour.`,
        `The ${n} is ${s.tilt}, razor sharp, wider than it is tall, and it leaves generous empty black space above and below itself.`,
        `Scattered behind it float five smaller extruded pictograms from the same world — ${s.satellites} — carved from the exact same glass, tilted at all different angles, at wildly uneven scales, one very large and cropped by the frame while the others sit small and far back, clustered into two uneven groups, one dense in the ${s.dense} and one sparse in the ${s.sparse}, leaving large empty black areas elsewhere, never arranged in a ring around the ${n}.`,
        `They are heavily out of focus, blurrier and dimmer toward the edges of the frame, three stops darker than the ${n} so that none of them catches the eye before it, reading as texture rather than as a second subject, and a halo of pure black separates them from the ${n} silhouette.`,
        `Heavy shallow depth of field: only the ${n} is razor sharp.`,
        `No floor, no horizon, no environment, no studio reflections, nothing beneath the objects, no ground glow, no contact shadow: everything floats in absolute darkness on a pure black #000000 background.`,
        `Ultra clean, glossy, high contrast, premium 3D.`,
        `No neon, no glowing lines, no text, no logos, ${s.people ?? 'no people'}.`,
    ].join(' ')
}

export function configureFal() {
    if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not configured')
    fal.config({ credentials: process.env.FAL_KEY })
}

async function draw(cacheKey: string, subject: GlassSubject): Promise<Buffer> {
    const cached = join(RAW_DIR, `${cacheKey}.png`)
    if (existsSync(cached)) return readFile(cached)

    const result = await fal.subscribe(MODEL, {
        input: { prompt: buildPrompt(subject), image_size: 'landscape_16_9', quality: 'high', num_images: 1, output_format: 'png' },
    })
    const url = (result.data as { images?: { url?: string }[] })?.images?.[0]?.url
    if (!url) throw new Error(`${cacheKey}: no image returned`)

    const png = Buffer.from(await (await fetch(url)).arrayBuffer())
    await mkdir(RAW_DIR, { recursive: true })
    await writeFile(cached, png)
    return png
}

async function bandTop(png: Buffer, height: number, band: number): Promise<number> {
    const { data, info } = await sharp(png).greyscale().resize({ width: 64 }).raw().toBuffer({ resolveWithObject: true })

    let weighted = 0
    let total = 0
    for (let row = 0; row < info.height; row++) {
        let sum = 0
        for (let col = 0; col < info.width; col++) sum += data[row * info.width + col]
        weighted += sum * (row + 0.5)
        total += sum
    }

    const centre = total === 0 ? info.height / 2 : weighted / total
    return Math.round(Math.min(Math.max((centre / info.height) * height - band / 2, 0), height - band))
}

const FADE_OVERLAY = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">` +
        `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${CARD_SURFACE}" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="${CARD_SURFACE}" stop-opacity="1"/>` +
        `</linearGradient></defs>` +
        `<rect x="0" y="${HEIGHT - FADE}" width="${WIDTH}" height="${FADE}" fill="url(#f)"/></svg>`,
)

export async function renderBand(cacheKey: string, subject: GlassSubject, outFile: string) {
    const png = await draw(cacheKey, subject)
    const { width = 0, height = 0 } = await sharp(png).metadata()
    const band = Math.round(width / (WIDTH / HEIGHT))

    const jpeg = await sharp(png)
        .extract({ left: 0, top: await bandTop(png, height, band), width, height: band })
        .resize(WIDTH, HEIGHT)
        .composite([{ input: FADE_OVERLAY, top: 0, left: 0 }])
        .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
        .toBuffer()

    await mkdir(dirname(outFile), { recursive: true })
    await writeFile(outFile, jpeg)
    console.log(`${outFile.slice(ROOT.length + 1)} ${Math.round(jpeg.byteLength / 1024)} kB`)
}
