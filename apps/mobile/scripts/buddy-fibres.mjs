// Renders the fibres of the buddy's soft materials (packages/ui BuddyMaterial.tsx) into the pictures
// the app lays over the block, since react-native-svg draws no filter. The web multiplies the body by
// the light its fibres catch, which never goes above 1: laying black at `1 - light` does the same.
//
//     node apps/mobile/scripts/buddy-fibres.mjs

import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium } from '../../../scripts/verify/shared.mjs'

const OUT = resolve(import.meta.dirname, '../assets/images/buddy')
// The frame of FIBRES_FRAME in material.tsx, in units of the drawing, and how many pixels a unit takes.
const FRAME = { x: 0, y: 20, width: 100, height: 90 }
const PIXELS_PER_UNIT = 4
const SOFTNESS = 0.7

const light = (frequency, octaves, surface, seed, diffuse) => `
    <feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" seed="${seed}" result="noise" />
    <feDiffuseLighting in="noise" surfaceScale="${surface}" diffuseConstant="${diffuse}" lighting-color="#fff" result="light">
        <feDistantLight azimuth="225" elevation="58" />
    </feDiffuseLighting>`

const RECIPES = {
    fluffy: `${light('1.1 0.45', 2, 1.05, 11, 1.1)}
        <feGaussianBlur in="light" stdDeviation="0.35" result="soft" />
        <feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="1" seed="13" result="hair" />
        <feDisplacementMap in="soft" in2="hair" scale="${3.2 * SOFTNESS}" xChannelSelector="R" yChannelSelector="G" />`,
    plush: `${light('2.2 1', 2, 0.55, 11, 1.06)}
        <feGaussianBlur in="light" stdDeviation="0.2" />`,
    felt: light('0.7', 4, 0.6 * SOFTNESS + 0.35, 5, 1.06),
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [material, recipe] of Object.entries(RECIPES)) {
    const width = FRAME.width * PIXELS_PER_UNIT
    const height = FRAME.height * PIXELS_PER_UNIT
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${FRAME.x} ${FRAME.y} ${FRAME.width} ${FRAME.height}">
        <filter id="f" filterUnits="userSpaceOnUse" x="${FRAME.x}" y="${FRAME.y}" width="${FRAME.width}" height="${FRAME.height}" color-interpolation-filters="sRGB">${recipe}</filter>
        <rect x="${FRAME.x}" y="${FRAME.y}" width="${FRAME.width}" height="${FRAME.height}" filter="url(#f)" />
    </svg>`
    const png = await page.evaluate(
        async ({ svg, width, height }) => {
            const image = new Image()
            image.src = `data:image/svg+xml;base64,${btoa(svg)}`
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext('2d')
            context.drawImage(image, 0, 0)
            const pixels = context.getImageData(0, 0, width, height)
            for (let i = 0; i < pixels.data.length; i += 4) {
                const lit = pixels.data[i] / 255
                pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 0
                pixels.data[i + 3] = Math.round((1 - lit) * 255)
            }
            context.putImageData(pixels, 0, 0)
            return canvas.toDataURL('image/png').split(',')[1]
        },
        { svg, width, height },
    )
    writeFileSync(resolve(OUT, `fibres-${material}.png`), Buffer.from(png, 'base64'))
    console.log(`fibres-${material}.png`)
}
await browser.close()
