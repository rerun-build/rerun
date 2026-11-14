export const LOCAL_SCHEME = 'rerun-shell'
export const LOCAL_ORIGIN = `${LOCAL_SCHEME}://app`

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

export function parseUrl(raw: string): URL | null {
    try {
        return new URL(raw)
    } catch {
        return null
    }
}

export function normalizeServerUrl(raw: string): string | null {
    const trimmed = raw.trim()
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = parseUrl(withScheme)
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null
    if (url.username || url.password) return null
    return url.origin
}

export function isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
}

export function isInsecureServer(origin: string): boolean {
    const url = parseUrl(origin)
    return !!url && url.protocol === 'http:' && !isLoopbackHost(url.hostname)
}

export function originOf(url: URL): string {
    return url.origin !== 'null' ? url.origin : `${url.protocol}//${url.host}`
}

export function isSameOrigin(raw: string, origin: string): boolean {
    const url = parseUrl(raw)
    return !!url && originOf(url) === origin
}

export function isExternalUrl(raw: string): boolean {
    const url = parseUrl(raw)
    return !!url && EXTERNAL_PROTOCOLS.has(url.protocol)
}

const PAYMENT_HOSTS = new Set(['checkout.stripe.com', 'connect.stripe.com'])

export function isPaymentPage(raw: string): boolean {
    const url = parseUrl(raw)
    return !!url && url.protocol === 'https:' && PAYMENT_HOSTS.has(url.hostname)
}

export type NavigationDecision = 'stay' | 'external' | 'deny'

export function decideNavigation(target: string, serverOrigin: string): NavigationDecision {
    if (isSameOrigin(target, serverOrigin)) return 'stay'
    if (isExternalUrl(target)) return 'external'
    return 'deny'
}

export type WindowOpenDecision = 'child' | 'external' | 'deny'

export function decideWindowOpen(target: string, serverOrigin: string): WindowOpenDecision {
    if (target === '' || target === 'about:blank') return 'child'
    if (isSameOrigin(target, serverOrigin)) return 'child'
    if (isExternalUrl(target)) return 'external'
    return 'deny'
}
