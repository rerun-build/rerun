import { Hono } from 'hono'
import { chromium, type Browser } from 'patchright'
import { z } from 'zod'
import { env } from '../../config/env.js'

const querySchema = z.object({
    url: z.string().url(),
    width: z.coerce.number().int().min(16).max(4096),
    height: z.coerce.number().int().min(16).max(4096),
    scale: z.coerce.number().min(0.5).max(4).default(1),
    format: z.enum(['png', 'webp']).default('png'),
    wait_for: z.string().max(500).optional(),
    timeout: z.coerce.number().int().min(1_000).max(60_000).default(30_000),
    dark: z.enum(['0', '1']).optional(),
})

export type ShotRequest = { url: string; width: number; height: number; scale: number; format: 'png' | 'webp'; waitFor: string | null; timeoutMs: number; dark: boolean | null }
export type Shooter = (request: ShotRequest) => Promise<Buffer>

let browser: Promise<Browser> | null = null

function sharedBrowser(): Promise<Browser> {
    browser ??= chromium.launch({ channel: 'chromium', headless: true }).then(launched => {
        launched.on('disconnected', () => (browser = null))
        return launched
    })
    return browser
}

export const shootPage: Shooter = async ({ url, width, height, scale, format, waitFor, timeoutMs, dark }) => {
    const context = await (await sharedBrowser()).newContext({
        viewport: { width, height },
        deviceScaleFactor: scale,
        ...(dark === null ? {} : { colorScheme: dark ? 'dark' : 'light' }),
    })
    try {
        const page = await context.newPage()
        await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })
        if (waitFor) await page.waitForSelector(waitFor, { timeout: timeoutMs })
        const cdp = await context.newCDPSession(page)
        const { data } = await cdp.send('Page.captureScreenshot', { format })
        return Buffer.from(data, 'base64')
    } finally {
        await context.close()
    }
}

export function createScreenshotRoutes(shoot: Shooter = shootPage): Hono {
    const routes = new Hono()
    routes.get('/', async c => {
        const query = querySchema.parse(c.req.query())
        const hub = env().RERUN_HUB_BASE_URL
        if (!hub || new URL(query.url).origin !== new URL(hub).origin) return c.json({ error: "Only pages of this engine's hub are captured." }, 403)

        const image = await shoot({
            url: query.url,
            width: query.width,
            height: query.height,
            scale: query.scale,
            format: query.format,
            waitFor: query.wait_for ?? null,
            timeoutMs: query.timeout,
            dark: query.dark === undefined ? null : query.dark === '1',
        })
        return c.body(new Uint8Array(image), 200, { 'Content-Type': `image/${query.format}` })
    })
    return routes
}
