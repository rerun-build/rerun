import { readFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { createOgCache, ogResponse } from './render-cache'
import { OG_HEIGHT, OG_SCALE, OG_WIDTH } from './size'
import { capturePage, type CaptureFormat } from './shot'

const FALLBACK_PATH = path.join(process.cwd(), 'public', 'og-image.png')

// A short life on purpose: the normal card is cached for a day and served stale for a week, which is
// exactly what a generic fallback must not inherit. A blip of rerun-shot then costs a minute, not a
// week of the wrong card in every unfurl.
const FALLBACK_CACHE_CONTROL = 'public, max-age=60, must-revalidate'

let fallbackImage: Buffer | null = null

const ogCache = createOgCache({ ttlMs: 60 * 60 * 1000, maxEntries: 200 })

// Bump this on any visual change to a captured card. It travels in the URL rerun-shot is asked to
// screenshot, so it is part of the cache key on both sides: the memo above and rerun-shot's own
// content-addressed disk cache. A template card also carries its row's `updated_at`, but that only
// covers an edit of the content: without this constant a change of the layout itself would keep
// serving the old image. The public URL never carries it, so crawlers keep the one they know.
export const OG_VERSION = '16'

export function readOgRequest(req: Request): { format: CaptureFormat; fresh: boolean } {
    const search = new URL(req.url).searchParams
    return { format: search.get('format') === 'webp' ? 'webp' : 'png', fresh: search.get('refresh') === '1' }
}

export async function ogFallbackResponse(req: Request): Promise<Response> {
    try {
        fallbackImage ??= await readFile(FALLBACK_PATH)
        return new Response(new Uint8Array(fallbackImage), {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': FALLBACK_CACHE_CONTROL, 'X-Og-Fallback': '1' },
        })
    } catch (error) {
        console.error('[og] fallback image unreadable', error)
        return Response.redirect(new URL('/og-image.png', req.url), 302)
    }
}

// The frame to capture. Defaults to the OG one, which is what every unfurl asks for; a caller
// states its own only when the image is not going into a link preview.
export type CaptureSize = { width: number; height: number; scale: number }

const OG_SIZE: CaptureSize = { width: OG_WIDTH, height: OG_HEIGHT, scale: OG_SCALE }

export async function captureOgCard({
    req,
    renderPath,
    cacheKey,
    format,
    fresh,
    label,
    size = OG_SIZE,
}: {
    req: Request
    renderPath: string
    cacheKey: string
    format: CaptureFormat
    fresh: boolean
    label: string
    size?: CaptureSize
}): Promise<Response> {
    if (!fresh) {
        const cached = ogCache.get(cacheKey)
        if (cached) return ogResponse(cached.body, cached.contentType)
    }

    try {
        const capture = await capturePage(renderPath, { requestUrl: req.url, width: size.width, height: size.height, scale: size.scale, format, fresh })
        // Chromium's own PNG encoder leaves a third to a half of the bytes on the table on a card this
        // flat; recompressing it losslessly keeps the 2x capture near the weight of the old 1x one.
        const body = format === 'png' ? await sharp(capture.body).png({ compressionLevel: 9 }).toBuffer() : capture.body
        ogCache.set(cacheKey, body, capture.contentType)
        return ogResponse(body, capture.contentType)
    } catch (error) {
        // Never memoised: a single failed capture would otherwise pin the generic card for an hour.
        console.error(`[og] capture failed for ${label}`, error)
        return ogFallbackResponse(req)
    }
}
