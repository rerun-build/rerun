// Where a URL may go, decided without Electron so the rules are unit tested. The main window only
// ever shows the configured server; everything else leaves for the system browser or is dropped.

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

// `null` when the text is not an http(s) URL. The path is dropped: a server is an origin.
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

// A plain http server is only accepted on the machine itself: anything else would carry the session
// cookie in clear.
export function isInsecureServer(origin: string): boolean {
    const url = parseUrl(origin)
    return !!url && url.protocol === 'http:' && !isLoopbackHost(url.hostname)
}

// Node gives a custom scheme the opaque origin "null" (`rerun-shell://app` included), where Chromium
// treats a registered standard scheme as a real origin: compared by scheme and host instead.
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

export type NavigationDecision = 'stay' | 'external' | 'deny'

// A navigation of the main window: the server's own pages stay, the web leaves for the browser,
// the rest (file:, javascript:, custom schemes) goes nowhere.
export function decideNavigation(target: string, serverOrigin: string): NavigationDecision {
    if (isSameOrigin(target, serverOrigin)) return 'stay'
    if (isExternalUrl(target)) return 'external'
    return 'deny'
}

export type WindowOpenDecision = 'child' | 'external' | 'deny'

// `window.open` and `target=_blank`. A blank window is a sign-in popup opened on the click and
// pointed at its provider afterwards, and a page of the server opened in a new window needs the app's
// session: both stay in a child window of the same session. Every other web page opens in the
// system browser, where the person has their passwords and sessions.
export function decideWindowOpen(target: string, serverOrigin: string): WindowOpenDecision {
    if (target === '' || target === 'about:blank') return 'child'
    if (isSameOrigin(target, serverOrigin)) return 'child'
    if (isExternalUrl(target)) return 'external'
    return 'deny'
}
