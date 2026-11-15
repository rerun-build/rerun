import 'server-only'

import { fetchPublic } from '@/lib/net/public-fetch'
import { fetchLogoBytes, rasterizeVectorLogo } from '@/lib/workspace/fetch-logo'

export type SiteIcon = { bytes: Uint8Array; contentType: string }

const HTML_LIMIT_BYTES = 256 * 1024
const HTML_TIMEOUT_MS = 4000
const TTL_MS = 24 * 60 * 60 * 1000
const ICON_PX = 128
const ICON_REL = /(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i

const found = new Map<string, { icon: SiteIcon | null; at: number }>()

export async function findSiteIcon(domain: string): Promise<SiteIcon | null> {
    const cached = found.get(domain)
    if (cached && Date.now() - cached.at < TTL_MS) return cached.icon

    const home = `https://${domain}/`
    const candidates = new Set([...(await declaredIcons(home)), new URL('/apple-touch-icon.png', home).href, new URL('/favicon.ico', home).href])
    let icon: SiteIcon | null = null
    for (const url of candidates) {
        const fetched = await fetchLogoBytes(url)
        if (!fetched.ok) continue
        icon = await servable(fetched.bytes)
        if (icon) break
    }
    found.set(domain, { icon, at: Date.now() })
    return icon
}

export function resetSiteIconsForTests(): void {
    found.clear()
}

export function parseIconLinks(html: string, base: string): string[] {
    const icons = [...html.matchAll(/<link\b[^>]*>/gi)]
        .map(match => ({ rel: attribute(match[0], 'rel'), href: attribute(match[0], 'href'), sizes: attribute(match[0], 'sizes'), type: attribute(match[0], 'type') }))
        .filter(link => link.href && link.rel && ICON_REL.test(link.rel) && URL.canParse(link.href, base))
        .map(link => ({ url: new URL(link.href!, base).href, px: declaredSize(link) }))
    return icons.sort((a, b) => b.px - a.px).map(icon => icon.url)
}

function declaredSize(link: { rel: string | null; href: string | null; sizes: string | null; type: string | null }): number {
    if (link.type === 'image/svg+xml' || /\.svg(?:$|\?)/i.test(link.href ?? '')) return 512
    const sizes = [...(link.sizes ?? '').matchAll(/(\d+)x\d+/gi)].map(match => Number(match[1]))
    if (sizes.length) return Math.max(...sizes)
    return /apple-touch-icon/i.test(link.rel ?? '') ? 180 : 16
}

function attribute(tag: string, name: string): string | null {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null
}

async function declaredIcons(home: string): Promise<string[]> {
    try {
        const res = await fetchPublic(home, { headers: { accept: 'text/html' } }, { timeoutMs: HTML_TIMEOUT_MS })
        if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('html')) return []
        return parseIconLinks(await readCapped(res.body, HTML_LIMIT_BYTES), home)
    } catch {
        return []
    }
}

async function readCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        text += decoder.decode(chunk.value, { stream: true })
        if (text.length >= limit) {
            await reader.cancel()
            break
        }
    }
    return text
}

async function servable(bytes: Uint8Array): Promise<SiteIcon | null> {
    const type = imageType(bytes)
    if (type === 'image/svg+xml') return { bytes: await rasterizeVectorLogo(bytes, ICON_PX), contentType: 'image/png' }
    return type ? { bytes, contentType: type } : null
}

export function imageType(bytes: Uint8Array): string | null {
    const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
    if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png'
    if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
    if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif'
    if (starts([0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
    if (starts([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
    if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(new TextDecoder().decode(bytes.subarray(0, 1024)))) return 'image/svg+xml'
    return null
}
