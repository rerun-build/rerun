import { site } from '@/lib/site'

// Rerun Shot: our own URL-in / image-out service (Fastify + Playwright). Anything satori cannot
// draw - the isogrid board above all - is captured from a real browser instead of redrawn.
const DEV = process.env.NODE_ENV === 'development'

// The hosted service cannot reach a laptop, so in dev the default is a local instance
// (`pnpm dev` in ~/Documents/Dev/rerun-shot), which is allowed to capture localhost.
const SHOT_URL = process.env.RERUN_SHOT_URL ?? (DEV ? 'http://localhost:4600' : 'https://shot.rerun.build')
const SHOT_API_KEY = process.env.RERUN_SHOT_API_KEY

export const OG_READY_SELECTOR = '[data-og-ready="true"]'

const CAPTURE_TIMEOUT_MS = 30_000

export type CaptureFormat = 'png' | 'webp'

export type Capture = { body: Buffer; contentType: string }

// `requestUrl` is what the render page is reached on in dev, where the port is whatever `next dev`
// settled for and rarely matches NEXT_PUBLIC_APP_URL. In production the request may arrive on an
// internal Railway host, so the configured public origin wins.
function renderOrigin(requestUrl: string): string {
    if (DEV) return new URL(requestUrl).origin
    return process.env.NEXT_PUBLIC_APP_URL ?? site.url
}

// `waitFor: null` captures a page we did not write, which carries no ready marker: the service then
// shoots once the page has loaded.
export async function capturePage(
    path: string,
    { requestUrl, width, height, scale = 1, format, fresh, waitFor = OG_READY_SELECTOR, dark }: { requestUrl: string; width: number; height: number; scale?: number; format: CaptureFormat; fresh?: boolean; waitFor?: string | null; dark?: boolean },
): Promise<Capture> {
    const endpoint = new URL('/screenshot', SHOT_URL)
    endpoint.searchParams.set('url', new URL(path, renderOrigin(requestUrl)).toString())
    endpoint.searchParams.set('width', String(width))
    endpoint.searchParams.set('height', String(height))
    endpoint.searchParams.set('scale', String(scale))
    endpoint.searchParams.set('format', format)
    if (waitFor) endpoint.searchParams.set('wait_for', waitFor)
    endpoint.searchParams.set('timeout', String(CAPTURE_TIMEOUT_MS))
    if (fresh) endpoint.searchParams.set('cache', '0')
    if (dark !== undefined) endpoint.searchParams.set('dark', dark ? '1' : '0')

    const res = await fetch(endpoint, {
        headers: SHOT_API_KEY ? { Authorization: `Bearer ${SHOT_API_KEY}` } : undefined,
        signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS + 5_000),
    })

    if (!res.ok) {
        throw new Error(`rerun-shot responded ${res.status}: ${await res.text()}`)
    }

    return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? `image/${format}`,
    }
}
