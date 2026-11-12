import { desktopShell } from './client'

// A service's sign-in from the desktop app: Google and most providers refuse a web view, so it runs
// in the system browser, through the iOS app's chain. The hub mints a ticket for this window, the
// browser signs in and the callback parks the token, the app is handed back a claim through its URL
// scheme, and this page claims it with its own session.

export type DesktopServiceTarget = { agentId: string; key: string } | { agentId: string; server: string }

export type DesktopServiceSignIn = { ok: true } | { ok: false; error: string }

// The provider's own screens can take a while (a password manager, a second factor), not forever.
const RETURN_TIMEOUT_MS = 10 * 60_000

export function desktopServiceSignInAvailable(): boolean {
    return desktopShell('oauth') !== null
}

function routeOf(target: DesktopServiceTarget): string {
    const agent = `/api/v1/agents/${encodeURIComponent(target.agentId)}`
    return 'key' in target ? `${agent}/services/${encodeURIComponent(target.key)}` : `${agent}/mcp/${encodeURIComponent(target.server)}`
}

async function errorOf(response: Response, fallback: string): Promise<string> {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    return body?.error ?? body?.message ?? fallback
}

export async function signInThroughBrowser(target: DesktopServiceTarget, fallbackError: string): Promise<DesktopServiceSignIn> {
    const shell = desktopShell('oauth')
    if (!shell) return { ok: false, error: fallbackError }
    const route = routeOf(target)
    const connect = await fetch(`${route}/connect`, { method: 'POST' })
    if (!connect.ok) return { ok: false, error: await errorOf(connect, fallbackError) }
    const { url } = (await connect.json()) as { url: string }

    const returned = new Promise<Parameters<Parameters<typeof shell.oauth.onReturn>[0]>[0] | null>((resolve) => {
        const timer = setTimeout(() => {
            off()
            resolve(null)
        }, RETURN_TIMEOUT_MS)
        const off = shell.oauth.onReturn((result) => {
            clearTimeout(timer)
            off()
            resolve(result)
        })
    })
    await shell.links.openExternal(url)
    const result = await returned
    if (!result) return { ok: false, error: fallbackError }
    if (result.status === 'error') return { ok: false, error: result.message || fallbackError }
    if (!result.claim) return { ok: true }

    const claimed = await fetch(`${route}/authorized`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: result.claim }) })
    if (!claimed.ok) return { ok: false, error: await errorOf(claimed, fallbackError) }
    return { ok: true }
}
