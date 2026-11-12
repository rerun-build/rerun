import { createHash, randomBytes } from 'node:crypto'
import { session as electronSession } from 'electron'
import { DESKTOP_AUTH_PATH, type DesktopSignInError, type DesktopSignInProvider, type DesktopSignInResult } from '@rerun/contracts'
import { IPC_EVENTS } from '../shared/ipc-channels'
import { CHANNEL } from './identity'
import { currentServer, getMainWindow, loadAppPath, openExternal, showMainWindow } from './main-window'
import { partitionFor } from './server'

// Sign-in through the system browser (Google refuses an embedded web view, and the browser has the
// person's passwords): RFC 8252 with PKCE. The app keeps the verifier and a state; the browser gets
// the challenge, signs in on the web, and hands a one-time code back through the app's URL scheme.

type Pending = { verifier: string; state: string; startedAt: number }

const PENDING_TTL_MS = 15 * 60_000

let pending: Pending | null = null

function base64url(bytes: Buffer): string {
    return bytes.toString('base64url')
}

function report(result: DesktopSignInResult): void {
    getMainWindow()?.webContents.send(IPC_EVENTS.authResult, result)
}

function livePending(): Pending | null {
    if (pending && Date.now() - pending.startedAt > PENDING_TTL_MS) pending = null
    return pending
}

export async function startBrowserSignIn(provider?: DesktopSignInProvider): Promise<void> {
    const origin = currentServer()
    if (!origin) return
    // A second click restarts with new secrets: only the last browser tab can finish.
    const verifier = base64url(randomBytes(32))
    pending = { verifier, state: base64url(randomBytes(24)), startedAt: Date.now() }
    const url = new URL(DESKTOP_AUTH_PATH, origin)
    url.searchParams.set('challenge', base64url(createHash('sha256').update(verifier).digest()))
    url.searchParams.set('state', pending.state)
    url.searchParams.set('channel', CHANNEL)
    if (provider === 'google' || provider === 'apple') url.searchParams.set('provider', provider)
    await openExternal(url.toString())
}

async function exchange(code: string, current: Pending): Promise<DesktopSignInResult> {
    const origin = currentServer()
    if (!origin) return { status: 'error', reason: 'network' }
    const session = electronSession.fromPartition(partitionFor(origin))
    let response: Response
    try {
        response = await session.fetch(`${origin}/api/desktop/auth/exchange`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': session.getUserAgent() },
            body: JSON.stringify({ code, verifier: current.verifier }),
            credentials: 'include',
        })
    } catch {
        return { status: 'error', reason: 'network' }
    }
    if (response.ok) return { status: 'signed-in' }
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    const reason: DesktopSignInError = body?.reason === 'expired' ? 'expired' : response.status >= 500 ? 'network' : 'invalid'
    return { status: 'error', reason }
}

async function finish(code: string, current: Pending): Promise<DesktopSignInResult> {
    const result = await exchange(code, current)
    if (result.status === 'signed-in') {
        pending = null
        loadAppPath('/')
    }
    report(result)
    return result
}

// The browser came back through `rerun-desktop://auth/callback`.
export async function completeFromLink(code: string, state: string): Promise<void> {
    showMainWindow()
    const current = livePending()
    if (!current || current.state !== state) {
        report({ status: 'error', reason: 'state-mismatch' })
        return
    }
    await finish(code, current)
}

// The code the browser shows, pasted by hand where the link could not reach the app.
export async function completeFromPastedCode(code: string): Promise<DesktopSignInResult> {
    const current = livePending()
    const trimmed = code.trim()
    if (!current) return { status: 'error', reason: 'expired' }
    if (!/^[A-Za-z0-9_-]{43}$/.test(trimmed)) return { status: 'error', reason: 'invalid' }
    return finish(trimmed, current)
}
