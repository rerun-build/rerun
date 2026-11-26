import { fetchPublic } from '@/lib/net/public-fetch'

import { failure, type ActionFailure } from '@/lib/i18n/action-error'

import { LOGO_MAX_BYTES } from './logo-input'

const FETCH_TIMEOUT_MS = 5000
// The favicon service answers with a redirect to its CDN, so a hop or two has to be followed, each
// one checked like the first.
const MAX_REDIRECTS = 3

type FetchedLogo = { ok: true; bytes: Uint8Array } | ActionFailure

// Downloads the image a logo link points at: public http(s) only, every redirect re-checked, an
// image content type, and never more than LOGO_MAX_BYTES read off the wire.
export async function fetchLogoBytes(url: string): Promise<FetchedLogo> {
    if (!URL.canParse(url)) return failure('noLogoFound')

    const res = await fetchPublic(url, {}, { timeoutMs: FETCH_TIMEOUT_MS, maxRedirects: MAX_REDIRECTS }).catch(() => null)
    if (!res) return failure('noLogoFound')

    if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').startsWith('image/')) return failure('noLogoFound')
    if (Number(res.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) return failure('imageTooLarge', { max: LOGO_MAX_BYTES / (1024 * 1024) })

    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body.getReader()
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        total += chunk.value.byteLength
        if (total > LOGO_MAX_BYTES) {
            await reader.cancel()
            return failure('imageTooLarge', { max: LOGO_MAX_BYTES / (1024 * 1024) })
        }
        chunks.push(chunk.value)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return { ok: true, bytes }
}

// sharp draws an SVG at its own declared size, often a 24px viewBox, and the resize that follows
// never enlarges: the logo would be stored as a smudge. So a vector is drawn at the density that
// lands it on the target size first.
export async function rasterizeVectorLogo(bytes: Uint8Array, targetSize: number): Promise<Uint8Array> {
    const { default: sharp } = await import('sharp')
    const { format, width, height } = await sharp(bytes).metadata()
    if (format !== 'svg' || !width || !height) return bytes
    const density = Math.min(2400, Math.ceil((72 * targetSize) / Math.max(width, height)))
    return new Uint8Array(await sharp(bytes, { density }).png().toBuffer())
}
