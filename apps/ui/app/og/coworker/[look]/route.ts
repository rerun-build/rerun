import { BARE_PARAM, bareSideOf, PORTRAIT_SIZE, PORTRAIT_VERSION, portraitOfSlug, type BareSide } from '@/lib/og/coworker-portrait'
import { createOgCache } from '@/lib/og/render-cache'
import { capturePage, type Capture } from '@/lib/og/shot'
import { CARD_SCALE } from '@/lib/og/size'

export const runtime = 'nodejs'

const DAY_MS = 24 * 60 * 60 * 1000
const portraits = createOgCache({ ttlMs: DAY_MS, maxEntries: 500 })

// One capture per look at a time: the hub asks for a portrait as it sends the push, then every phone that
// receives it does.
const captures = new Map<string, Promise<Capture>>()

const cacheKey = (look: string, bare: BareSide | null) => (bare ? `${look}:${bare}` : look)

function capture(look: string, bare: BareSide | null, requestUrl: string): Promise<Capture> {
    const key = cacheKey(look, bare)
    const running = captures.get(key)
    if (running) return running
    const path = `/render/coworker/${look}?v=${PORTRAIT_VERSION}${bare ? `&${BARE_PARAM}=${bare}` : ''}`
    const started = capturePage(path, { requestUrl, width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, scale: CARD_SCALE, format: 'png', transparent: bare !== null }).finally(() => captures.delete(key))
    captures.set(key, started)
    return started
}

function portraitResponse(body: Buffer, contentType: string): Response {
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' } })
}

// The picture a phone puts beside a push, or alone (`bare`) beside its message in an email. A capture
// that fails answers an error, never the generic card of the other /og routes: the phone then keeps the
// app's icon, and the email does without it.
export async function GET(req: Request, { params }: { params: Promise<{ look: string }> }) {
    const { look } = await params
    if (!portraitOfSlug(look)) return new Response('Unknown look', { status: 404 })

    const bare = bareSideOf(new URL(req.url).searchParams.get(BARE_PARAM))
    const key = cacheKey(look, bare)
    const cached = portraits.get(key)
    if (cached) return portraitResponse(cached.body, cached.contentType)

    try {
        const { body, contentType } = await capture(look, bare, req.url)
        portraits.set(key, body, contentType)
        return portraitResponse(body, contentType)
    } catch (error) {
        console.error(`[og] portrait capture failed for ${look}`, error)
        return new Response('Portrait unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
    }
}
