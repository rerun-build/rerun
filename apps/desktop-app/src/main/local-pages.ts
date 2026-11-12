import { net, protocol, type Session } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LOCAL_ORIGIN, LOCAL_SCHEME } from './url-policy'

export type LocalPage = 'offline' | 'find' | 'server'

// The shell's own pages (offline, find bar, server picker) are served from `rerun-shell://app/`,
// never from `file://`: a standard, secure origin of their own, with a strict CSP.
export function registerLocalScheme(): void {
    protocol.registerSchemesAsPrivileged([{ scheme: LOCAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"

const RENDERER_DIR = join(import.meta.dirname, '../renderer')

export function serveLocalPages(session: Session): void {
    if (session.protocol.isProtocolHandled(LOCAL_SCHEME)) return
    session.protocol.handle(LOCAL_SCHEME, async (request) => {
        const url = new URL(request.url)
        if (url.host !== 'app') return new Response('Not found', { status: 404 })
        // Under `electron-vite dev` the pages come from Vite's server, with hot reload.
        const devServer = process.env.ELECTRON_RENDERER_URL
        if (devServer) return net.fetch(`${devServer}${url.pathname}${url.search}`)
        const file = normalize(join(RENDERER_DIR, decodeURIComponent(url.pathname)))
        if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Not found', { status: 404 })
        const response = await net.fetch(pathToFileURL(file).toString())
        const headers = new Headers(response.headers)
        if (file.endsWith('.html')) headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
        return new Response(response.body, { status: response.status, headers })
    })
}

export function localPageUrl(page: LocalPage, params: Record<string, string> = {}): string {
    const url = new URL(`${LOCAL_ORIGIN}/${page}.html`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
}
