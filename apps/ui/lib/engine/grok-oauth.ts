// Grok device-code sign-in: the person types a short code on xAI's own page while the hub polls, the
// way Grok Build signs in on a machine without a browser. The hub only makes the first exchange; the
// engine keeps the tokens fresh from then on (apps/engine grok-token.ts), so the hub never refreshes.
//
// xAI's public client of Grok Build and its scopes are shared with the engine (`@rerun/contracts`).
// Nothing a response says about where to go next is followed: the endpoints are fixed here.
//
// This module runs server-side only.

import { AppError } from '@/lib/i18n/action-error'
import { GROK_AUTH_ORIGIN, GROK_OAUTH_CLIENT_ID, GROK_OAUTH_SCOPES } from '@rerun/contracts'

const DEVICE_CODE_URL = `${GROK_AUTH_ORIGIN}/oauth2/device/code`
const TOKEN_URL = `${GROK_AUTH_ORIGIN}/oauth2/token`
// Where the person approves. The address xAI answers with is only shown when it is on this origin.
const VERIFICATION_ORIGIN = 'https://accounts.x.ai'
const VERIFICATION_URL = `${VERIFICATION_ORIGIN}/oauth2/device`

const MIN_POLL_INTERVAL_S = 5
// A poll that lands a moment early is answered `slow_down`: the interval xAI asks for is kept clear of.
const POLL_INTERVAL_MARGIN_MS = 1000
const DEFAULT_TTL_S = 15 * 60
const REQUEST_TIMEOUT_MS = 10_000
const FALLBACK_LIFETIME_MS = 3_600_000

export type GrokDeviceAuthStart = { deviceCode: string; userCode: string; verificationUrl: string; pollIntervalMs: number; expiresAt: number }

export type GrokOAuthTokens = { accessToken: string; refreshToken: string; idToken: string; accountId: string | null; expiresAt: number }

function claimsOf(jwt: string): Record<string, unknown> | null {
    try {
        return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
    } catch {
        return null
    }
}

function verificationUrlOf(answer: { verification_uri_complete?: unknown; verification_uri?: unknown }): string {
    for (const candidate of [answer.verification_uri_complete, answer.verification_uri]) {
        if (typeof candidate !== 'string') continue
        try {
            if (new URL(candidate).origin === VERIFICATION_ORIGIN) return candidate
        } catch {
            // Not an address: the fixed one stands in.
        }
    }
    return VERIFICATION_URL
}

export async function startGrokDeviceAuth(): Promise<GrokDeviceAuthStart> {
    const res = await fetch(DEVICE_CODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: GROK_OAUTH_CLIENT_ID, scope: GROK_OAUTH_SCOPES }),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) throw new AppError(res.status === 400 || res.status === 401 || res.status === 403 ? 'grokDeviceLoginRefused' : 'startConnectionFailedStatus', { status: res.status })
    const answer = (await res.json().catch(() => ({}))) as { device_code?: unknown; user_code?: unknown; verification_uri?: unknown; verification_uri_complete?: unknown; interval?: unknown; expires_in?: unknown }
    if (typeof answer.device_code !== 'string' || typeof answer.user_code !== 'string') throw new AppError('malformedDeviceAuthResponse')
    const interval = Number(answer.interval)
    const ttl = Number(answer.expires_in)
    return {
        deviceCode: answer.device_code,
        userCode: answer.user_code,
        verificationUrl: verificationUrlOf(answer),
        pollIntervalMs: Math.max(MIN_POLL_INTERVAL_S, Number.isFinite(interval) ? interval : 0) * 1000 + POLL_INTERVAL_MARGIN_MS,
        expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_S) * 1000,
    }
}

// What xAI answers while the person has not approved yet: `slow_down` asks the next polls to come
// further apart.
type GrokDeviceAuthWait = 'pending' | 'slow_down'

// One poll. A refusal never carries xAI's body.
export async function pollGrokDeviceAuth(deviceCode: string): Promise<GrokOAuthTokens | GrokDeviceAuthWait> {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: GROK_OAUTH_CLIENT_ID }),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const answer = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; id_token?: unknown; expires_in?: unknown; error?: unknown }
    if (res.ok && typeof answer.access_token === 'string') {
        const idToken = typeof answer.id_token === 'string' ? answer.id_token : ''
        const sub = idToken ? claimsOf(idToken)?.sub : undefined
        return {
            accessToken: answer.access_token,
            refreshToken: typeof answer.refresh_token === 'string' ? answer.refresh_token : '',
            idToken,
            accountId: typeof sub === 'string' ? sub : null,
            expiresAt: typeof answer.expires_in === 'number' && answer.expires_in > 0 ? Date.now() + answer.expires_in * 1000 : Date.now() + FALLBACK_LIFETIME_MS,
        }
    }
    if (answer.error === 'authorization_pending') return 'pending'
    if (answer.error === 'slow_down') return 'slow_down'
    if (answer.error === 'access_denied') throw new AppError('grokSignInDenied')
    // An expired code, or one that was already exchanged (a ticket played twice).
    if (answer.error === 'expired_token' || answer.error === 'invalid_grant') throw new AppError('grokSignInExpired')
    throw new AppError('deviceAuthFailed')
}

// A sign-in exchanged and then not stored would leave a live lineage nobody holds: it is handed back.
// Best effort, as on the engine's delete.
export async function revokeGrokKeys(keys: Record<string, string>): Promise<void> {
    for (const [key, hint] of [['GROK_OAUTH_REFRESH_TOKEN', 'refresh_token'], ['GROK_OAUTH_TOKEN', 'access_token']] as const) {
        const token = keys[key]
        if (!token) continue
        await fetch(`${GROK_AUTH_ORIGIN}/oauth2/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, token_type_hint: hint, client_id: GROK_OAUTH_CLIENT_ID }),
            redirect: 'error',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }).catch(() => undefined)
    }
}

// The engine reads these back from the connection's .env (apps/engine grok-token.ts).
export function grokKeysFrom(tokens: GrokOAuthTokens): Record<string, string> {
    const keys: Record<string, string> = { GROK_OAUTH_TOKEN: tokens.accessToken, GROK_OAUTH_EXPIRES_AT: String(tokens.expiresAt) }
    if (tokens.refreshToken) keys.GROK_OAUTH_REFRESH_TOKEN = tokens.refreshToken
    if (tokens.idToken) keys.GROK_OAUTH_ID_TOKEN = tokens.idToken
    if (tokens.accountId) keys.GROK_OAUTH_ACCOUNT_ID = tokens.accountId
    return keys
}
