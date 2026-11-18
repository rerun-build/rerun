// Turns a scene into the files `<Shot>` and `<Loop>` read: one element of the real app, framed,
// in light and dark, written to apps/docs/images/<page>/.

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { REPO_ROOT, UI_DIR, fail, log, settle } from '../verify/shared.mjs'
import { DEMO_NOW } from './demo-workspace.mjs'

const sharp = createRequire(join(UI_DIR, 'package.json'))('sharp')

export const IMAGES_DIR = join(REPO_ROOT, 'apps/docs/images')
export const THEMES = ['light', 'dark']
const VIEWPORT = { width: 1440, height: 900 }
const MAX_WIDTH = 1600
const WEBP_BUDGET = 300 * 1024
const MP4_BUDGET = 3 * 1024 * 1024
const LOOP_MAX_SECONDS = 15
const FFMPEG = process.env.FFMPEG || 'ffmpeg'

export function assertFfmpeg() {
    try {
        execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' })
    } catch {
        fail(`The loops are encoded with ffmpeg (libx264), and \`${FFMPEG}\` does not run. Install it (\`brew install ffmpeg\`, \`apt install ffmpeg\`), point FFMPEG at it, or pass --no-video.`)
    }
}

// What would change from one run to the next or distract from the screen: the caret, the scrollbars.
const STILL_CSS = `
*, *::before, *::after { caret-color: transparent !important; }
::-webkit-scrollbar { display: none !important; }
* { scrollbar-width: none !important; }
`

async function newContext(browser, base, storageState, theme, view, extra = {}) {
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        colorScheme: theme,
        reducedMotion: 'reduce',
        locale: 'en-US',
        timezoneId: 'Europe/Lisbon',
        storageState,
        ...extra,
    })
    await context.addCookies([
        { name: 'rerun-consent', value: `v1:denied:${DEMO_NOW.getTime()}`, url: base },
        { name: 'rerun-workspace-view', value: view, url: base },
        { name: 'NEXT_LOCALE', value: 'en', url: base },
    ])
    await context.addInitScript(
        ({ theme, view }) => {
            localStorage.setItem('theme', theme)
            localStorage.setItem('rerun:workspace-view', view)
        },
        { theme, view },
    )
    const page = await context.newPage()
    await page.clock.setFixedTime(DEMO_NOW)
    page.on('load', () => page.addStyleTag({ content: STILL_CSS }).catch(() => {}))
    return { context, page }
}

async function toWebp(png, path) {
    const image = sharp(png).resize({ width: MAX_WIDTH, withoutEnlargement: true })
    let quality = 86
    let webp = await image.clone().webp({ quality, effort: 6 }).toBuffer()
    while (webp.length > WEBP_BUDGET && quality > 50) {
        quality -= 8
        webp = await image.clone().webp({ quality, effort: 6 }).toBuffer()
    }
    writeFileSync(path, webp)
    return webp.length
}

// `fit` drops the fixed height a panel keeps for a longer list, so the picture ends with its content.
async function framed(shot, ctx) {
    const target = await shot.frame(ctx)
    await target.waitFor({ state: 'visible', timeout: 20_000 })
    if (shot.ready) await shot.ready(ctx).waitFor({ state: 'visible', timeout: 20_000 })
    await target.locator('[data-slot="skeleton"], .animate-pulse').first().waitFor({ state: 'hidden', timeout: 20_000 })
    await settle(ctx.page)
    if (shot.fit) {
        await target.evaluate((element) => {
            element.style.height = 'auto'
            element.style.minHeight = '0'
        })
        await ctx.page.waitForTimeout(300)
    }
    return target
}

async function captureShot({ browser, base, storageState, scene, shot, demo, theme }) {
    const { context, page } = await newContext(browser, base, storageState, theme, shot.view ?? scene.view ?? 'board')
    try {
        const ctx = { page, base, demo }
        await shot.open(ctx)
        await settle(page)
        const target = await framed(shot, ctx)
        const png = await target.screenshot({ animations: 'disabled', type: 'png' })
        const path = join(IMAGES_DIR, scene.page, `${shot.name}.${theme}.webp`)
        const size = await toWebp(png, path)
        return [{ path, size }]
    } finally {
        await context.close()
    }
}

// A loop is cropped once for the whole gesture: the frame before and after it, whichever is larger.
function union(a, b) {
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x)))
    const top = Math.max(0, Math.floor(Math.min(a.y, b.y)))
    const right = Math.min(VIEWPORT.width, Math.ceil(Math.max(a.x + a.width, b.x + b.width)))
    const bottom = Math.min(VIEWPORT.height, Math.ceil(Math.max(a.y + a.height, b.y + b.height)))
    return { x: left, y: top, width: right - left, height: bottom - top }
}

async function captureLoop({ browser, base, storageState, scene, shot, demo, theme, workDir }) {
    const videoDir = join(workDir, `${scene.page}-${shot.name}-${theme}`)
    rmSync(videoDir, { recursive: true, force: true })
    const startedAt = Date.now()
    const { context, page } = await newContext(browser, base, storageState, theme, shot.view ?? scene.view ?? 'board', {
        deviceScaleFactor: 1,
        recordVideo: { dir: videoDir, size: VIEWPORT },
    })
    const outputs = []
    let clip
    let playFrom
    let playTo
    try {
        const ctx = { page, base, demo }
        await shot.open(ctx)
        await settle(page)
        const target = await framed(shot, ctx)
        const before = await target.boundingBox()
        const poster = await page.screenshot({ type: 'png' })
        playFrom = (Date.now() - startedAt) / 1000
        await shot.play(ctx)
        await page.waitForTimeout(shot.hold ?? 1200)
        playTo = (Date.now() - startedAt) / 1000
        clip = union(before, await target.boundingBox())
        const posterPath = join(IMAGES_DIR, scene.page, `${shot.name}.${theme}.webp`)
        const posterCrop = await sharp(poster).extract({ left: clip.x, top: clip.y, width: clip.width, height: clip.height }).png().toBuffer()
        outputs.push({ path: posterPath, size: await toWebp(posterCrop, posterPath) })
    } finally {
        await context.close()
    }
    const recording = await page.video().path()
    const duration = Math.min(playTo - playFrom, LOOP_MAX_SECONDS)
    const even = (value) => value - (value % 2)
    const mp4Path = join(IMAGES_DIR, scene.page, `${shot.name}.${theme}.mp4`)
    const encode = (crf) =>
        execFileSync(FFMPEG, [
            '-loglevel', 'error', '-y',
            '-ss', playFrom.toFixed(2), '-t', duration.toFixed(2), '-i', recording,
            '-vf', `crop=${even(clip.width)}:${even(clip.height)}:${clip.x}:${clip.y},fps=25`,
            '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
            mp4Path,
        ])
    let crf = 24
    encode(crf)
    while (statSync(mp4Path).size > MP4_BUDGET && crf < 36) {
        crf += 3
        encode(crf)
    }
    outputs.push({ path: mp4Path, size: statSync(mp4Path).size })
    return outputs
}

export async function captureScene({ browser, base, storageState, scene, demo, workDir, video }) {
    mkdirSync(join(IMAGES_DIR, scene.page), { recursive: true })
    const written = []
    for (const shot of scene.shots ?? []) {
        for (const theme of THEMES) written.push(...(await captureShot({ browser, base, storageState, scene, shot, demo, theme })))
    }
    if (video) {
        for (const shot of scene.loops ?? []) {
            for (const theme of THEMES) written.push(...(await captureLoop({ browser, base, storageState, scene, shot, demo, theme, workDir })))
        }
    }
    for (const file of written) log(`${relative(REPO_ROOT, file.path)} · ${Math.round(file.size / 1024)} KB`)
    return written
}
