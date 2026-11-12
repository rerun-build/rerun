#!/usr/bin/env node
// The app icon of each channel, from the iOS app's icon (apps/mobile/assets/images/icon.png):
// the macOS shape (a rounded square on a 1024 canvas, 100 px of margin, its own shadow), and a band
// that names the channel on the staging and development apps so they are never mistaken for Rerun.
// electron-builder turns each 1024 PNG into the .icns, .ico and Linux sizes.
//
//   node scripts/make-icons.mjs
//
// It also draws the tray icons: the R of the logo (`R_PATH` of packages/ui's Logo) as a macOS template
// image (black, the system tints it) and in color for Windows and Linux, and the dot laid over the
// taskbar button on Windows when something waits.

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, '../mobile/assets/images/icon.png')
const CANVAS = 1024
const TILE = 824
const MARGIN = (CANVAS - TILE) / 2
const RADIUS = 185

const BANDS = {
    stable: null,
    staging: { label: 'STAGING', color: '#f59e0b' },
    dev: { label: 'DEV', color: '#10b981' },
}

function roundedMask(size, radius) {
    return Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`)
}

function band({ label, color }) {
    const height = 150
    return Buffer.from(
        `<svg width="${TILE}" height="${TILE}"><rect x="0" y="${TILE - height}" width="${TILE}" height="${height}" fill="${color}"/><text x="${TILE / 2}" y="${TILE - height / 2}" font-family="Helvetica Neue, Arial, sans-serif" font-size="78" font-weight="700" letter-spacing="6" fill="#111" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`,
    )
}

const shadow = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs><rect x="${MARGIN}" y="${MARGIN + 12}" width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="rgba(0,0,0,0.32)" filter="url(#s)"/></svg>`,
)

for (const [channel, channelBand] of Object.entries(BANDS)) {
    const layers = channelBand ? [{ input: band(channelBand) }] : []
    const tile = await sharp(SOURCE)
        .resize(TILE, TILE)
        .composite([...layers, { input: roundedMask(TILE, RADIUS), blend: 'dest-in' }])
        .png()
        .toBuffer()
    const out = join(ROOT, 'resources/icons', channel, 'icon.png')
    mkdirSync(dirname(out), { recursive: true })
    await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: shadow }, { input: tile, left: MARGIN, top: MARGIN }])
        .png()
        .toFile(out)
    console.log(`wrote ${out}`)
}

const R_PATH = readFileSync(join(ROOT, '../../packages/ui/src/logo/Logo.tsx'), 'utf8').match(/R_PATH =\s*'([^']+)'/)[1]

function glyph(size, color) {
    return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 512 512"><path d="${R_PATH}" fill="${color}"/></svg>`)
}

const TRAY = join(ROOT, 'resources/tray')
mkdirSync(TRAY, { recursive: true })
await sharp(glyph(16, '#000')).png().toFile(join(TRAY, 'trayTemplate.png'))
await sharp(glyph(32, '#000')).resize(32, 32).png().toFile(join(TRAY, 'trayTemplate@2x.png'))
await sharp(glyph(32, '#4d34f7')).resize(32, 32).png().toFile(join(TRAY, 'tray.png'))
await sharp(Buffer.from('<svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="#ef4444" stroke="#fff" stroke-width="1.5"/></svg>')).png().toFile(join(TRAY, 'badge.png'))
console.log(`wrote ${TRAY}`)
