import { readFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { createOgCache, ogResponse } from './render-cache'
import { OG_HEIGHT, OG_SCALE, OG_WIDTH } from './size'
import { capturePage, type CaptureFormat } from './shot'

const FALLBACK_PATH = path.join(process.cwd(), 'public', 'og-image.png')

const FALLBACK_CACHE_CONTROL = 'public, max-age=60, must-revalidate'

let fallbackImage: Buffer | null = null

const ogCache = createOgCache({ ttlMs: 60 * 60 * 1000, maxEntries: 200 })

export const OG_VERSION = '15'

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
        const body = format === 'png' ? await sharp(capture.body).png({ compressionLevel: 9 }).toBuffer() : capture.body
        ogCache.set(cacheKey, body, capture.contentType)
        return ogResponse(body, capture.contentType)
    } catch (error) {
        console.error(`[og] capture failed for ${label}`, error)
        return ogFallbackResponse(req)
    }
}
