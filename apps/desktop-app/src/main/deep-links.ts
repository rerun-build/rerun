import { DESKTOP_AUTH_CALLBACK_HOST, DESKTOP_AUTH_CALLBACK_PATH } from '@rerun/contracts'
import { parseUrl } from './url-policy'

// A link to the app's URL scheme comes from anywhere (a web page, another app, a terminal): it is
// read as hostile. Only the shapes below are accepted, and what they carry is checked again by
// whoever uses it: a one-time code is spent against the verifier, a path stays a path of the server.
export type DeepLink = { kind: 'auth-callback'; code: string; state: string }

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/

export function parseDeepLink(raw: string, scheme: string): DeepLink | null {
    const url = parseUrl(raw)
    if (!url || url.protocol !== `${scheme}:`) return null
    if (url.host === DESKTOP_AUTH_CALLBACK_HOST && url.pathname === DESKTOP_AUTH_CALLBACK_PATH) {
        const code = url.searchParams.get('code') ?? ''
        const state = url.searchParams.get('state') ?? ''
        if (!TOKEN.test(code) || !TOKEN.test(state)) return null
        return { kind: 'auth-callback', code, state }
    }
    return null
}

// Windows and Linux hand a link over as a command line argument, among Chromium's own.
export function deepLinkInArgv(argv: readonly string[], scheme: string): string | null {
    return argv.find((argument) => argument.toLowerCase().startsWith(`${scheme}://`)) ?? null
}
