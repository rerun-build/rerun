import { faviconUrl, siteDomain } from '@/lib/onboarding/site-favicon'

export type LogoLink = { kind: 'site'; domain: string } | { kind: 'image'; url: string }

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp'

export const LOGO_MAX_BYTES = 8 * 1024 * 1024

export const NO_LOGO_FOUND = 'No logo found at this address'
export const LOGO_TOO_LARGE = 'Image is too large (max 8MB).'

const IMAGE_PATH = /\.(png|jpe?g|svg|webp|gif|ico)$/i

export function readLogoLink(input: string): LogoLink | null {
    const trimmed = input.trim()
    if (URL.canParse(trimmed)) {
        const url = new URL(trimmed)
        if (/^https?:$/.test(url.protocol) && IMAGE_PATH.test(url.pathname)) return { kind: 'image', url: trimmed }
    }
    const domain = siteDomain(trimmed)
    return domain ? { kind: 'site', domain } : null
}

export function logoLinkImageUrl(link: LogoLink): string {
    return link.kind === 'site' ? faviconUrl(link.domain) : link.url
}
