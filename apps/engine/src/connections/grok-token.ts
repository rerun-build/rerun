import { CONNECTION_TOKEN_KEY, GROK_AUTH_ORIGIN, GROK_OAUTH_CLIENT_ID } from '@rerun/contracts'
import { connectionEnvPath } from '../config/paths.js'
import { readEnvFile, writeEnvFile } from '../lib/env-file.js'
import { logger } from '../lib/logger.js'
import { forgetCredentialRejected, recordCredentialRejected } from './credential-rejections.js'
import { withConnectionLock } from './lock.js'
import type { LoadedConnection } from './types.js'

const TOKEN_KEY = CONNECTION_TOKEN_KEY.grok
const REFRESH_KEY = 'GROK_OAUTH_REFRESH_TOKEN'
const ID_TOKEN_KEY = 'GROK_OAUTH_ID_TOKEN'
const EXPIRES_KEY = 'GROK_OAUTH_EXPIRES_AT'

const TOKEN_URL = `${GROK_AUTH_ORIGIN}/oauth2/token`
const REVOKE_URL = `${GROK_AUTH_ORIGIN}/oauth2/revoke`

// xAI's access tokens live six hours. Two minutes ahead leaves a request room to land before it lapses.
const REFRESH_SKEW_MS = 2 * 60_000
// After a refresh that could not reach xAI, the token in hand is used as is for this long before
// trying again, unless it has run out or a request was refused with it.
const FAILED_REFRESH_BACKOFF_MS = 30_000
const RETRY_DELAYS_MS = [1_000, 4_000]
const REQUEST_TIMEOUT_MS = 10_000
const REVOKE_TIMEOUT_MS = 5_000
const FALLBACK_LIFETIME_MS = 3_600_000

// xAI's answers to a refresh token it will never honour again: the user has to sign in again.
const DEAD_GRANT_ERRORS = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client'])

/**
 * `signedOut`: the sign-in is gone and only a new one brings it back. `unavailable`: xAI could not
 * be reached and the token in hand has run out; the next call tries again. Both messages read as
 * what they are in the chat (`classifyChatError`): a 401, a service unavailable.
 */
export class GrokAuthError extends Error {
    constructor(readonly kind: 'signedOut' | 'unavailable') {
        super(kind === 'signedOut' ? 'Grok sign-in expired (401): sign in to Grok again in AI providers.' : 'Grok sign-in service unavailable: try again in a moment.')
        this.name = 'GrokAuthError'
    }
}

type TokenAnswer = { access_token?: unknown; refresh_token?: unknown; id_token?: unknown; expires_in?: unknown; error?: unknown }

const inFlight = new Map<string, Promise<void>>()
const lastFailedAt = new Map<string, number>()

function expiresAtOf(env: Record<string, string>): number | null {
    const at = Number(env[EXPIRES_KEY])
    return env[EXPIRES_KEY] && Number.isFinite(at) ? at : null
}

function isFresh(env: Record<string, string>): boolean {
    const expiresAt = expiresAtOf(env)
    return !!env[TOKEN_KEY] && expiresAt !== null && expiresAt - Date.now() > REFRESH_SKEW_MS
}

function stillValid(env: Record<string, string>): boolean {
    const expiresAt = expiresAtOf(env)
    return !!env[TOKEN_KEY] && expiresAt !== null && expiresAt > Date.now()
}

function jwtExpiry(token: string): number | null {
    try {
        const exp = (JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown }).exp
        return typeof exp === 'number' ? exp * 1000 : null
    } catch {
        return null
    }
}

function expiryOf(answer: TokenAnswer, accessToken: string): number {
    if (typeof answer.expires_in === 'number' && answer.expires_in > 0) return Date.now() + answer.expires_in * 1000
    return jwtExpiry(accessToken) ?? Date.now() + FALLBACK_LIFETIME_MS
}

// The connection object is shared by every agent drawing on it: writing into it is what makes the
// fresh token visible box-wide without a reload.
function adopt(connection: LoadedConnection, env: Record<string, string>): void {
    for (const key of [TOKEN_KEY, REFRESH_KEY, ID_TOKEN_KEY, EXPIRES_KEY]) {
        if (env[key]) connection.env[key] = env[key]
    }
}

type Posted = { status: number; answer: TokenAnswer } | { status: null }

// Only a network failure, a 429 or a 5xx is tried again: any other answer is xAI's last word.
async function postRefresh(refreshToken: string): Promise<Posted> {
    for (let attempt = 0; ; attempt++) {
        const delay = RETRY_DELAYS_MS[attempt]
        try {
            const res = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: GROK_OAUTH_CLIENT_ID }),
                redirect: 'error',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            })
            const transient = res.status === 429 || res.status >= 500
            if (!transient || delay === undefined) return { status: res.status, answer: (await res.json().catch(() => ({}))) as TokenAnswer }
        } catch {
            if (delay === undefined) return { status: null }
        }
        await new Promise(resolve => setTimeout(resolve, delay))
    }
}

/**
 * Held under the connection's lock from the read of `.env` to the write of the new tokens: xAI
 * rotates the refresh token on every use, so two refreshes of one lineage must never cross, and a
 * reconnect (`PATCH /connections/:id/keys`, same lock) lands either before or after, never between.
 * The new tokens are on disk before anyone uses them: a crash after xAI answered loses nothing a
 * restart cannot pick up.
 */
async function refreshUnderLock(connection: LoadedConnection, rejectedToken: string | undefined): Promise<void> {
    await withConnectionLock(connection.id, async () => {
        const path = connectionEnvPath(connection.id)
        const disk = await readEnvFile(path)
        // Done already, by a reconnect or a call that went first: the token on disk is not the one
        // that was refused, or still has time ahead of it.
        const renewedMeanwhile = rejectedToken !== undefined ? !!disk[TOKEN_KEY] && disk[TOKEN_KEY] !== rejectedToken : isFresh(disk)
        if (renewedMeanwhile) {
            adopt(connection, disk)
            return
        }
        const refreshToken = disk[REFRESH_KEY]
        if (!refreshToken) {
            recordCredentialRejected(connection.id)
            throw new GrokAuthError('signedOut')
        }

        const posted = await postRefresh(refreshToken)
        const accessToken = posted.status === 200 && typeof posted.answer.access_token === 'string' ? posted.answer.access_token : null
        if (posted.status !== null && accessToken) {
            const { answer } = posted
            const next: Record<string, string> = {
                ...disk,
                [TOKEN_KEY]: accessToken,
                [REFRESH_KEY]: typeof answer.refresh_token === 'string' && answer.refresh_token ? answer.refresh_token : refreshToken,
                [EXPIRES_KEY]: String(expiryOf(answer, accessToken)),
            }
            if (typeof answer.id_token === 'string' && answer.id_token) next[ID_TOKEN_KEY] = answer.id_token
            await writeEnvFile(path, next)
            adopt(connection, next)
            forgetCredentialRejected(connection.id)
            lastFailedAt.delete(connection.id)
            logger.info({ connection: connection.id, rotated: next[REFRESH_KEY] !== refreshToken, expiresAt: Number(next[EXPIRES_KEY]) }, 'grok token refreshed')
            return
        }

        const error = posted.status !== null && typeof posted.answer.error === 'string' ? posted.answer.error : null
        if (posted.status !== null && posted.status < 500 && posted.status !== 429 && error && DEAD_GRANT_ERRORS.has(error)) {
            logger.error({ connection: connection.id, status: posted.status, error }, 'grok sign-in refused: the user has to sign in again')
            recordCredentialRejected(connection.id)
            throw new GrokAuthError('signedOut')
        }
        logger.warn({ connection: connection.id, status: posted.status, error }, 'grok token refresh failed')
        lastFailedAt.set(connection.id, Date.now())
        // Never a sign-out on a failure xAI may well recover from: the token in hand keeps serving
        // while it lasts, unless it is the one that was just refused.
        adopt(connection, disk)
        if (rejectedToken === undefined && stillValid(disk)) return
        throw new GrokAuthError('unavailable')
    })
}

/**
 * Makes sure `connection.env` holds an access token worth sending. `rejectedToken` is the token a
 * request was just refused with (401): it forces a refresh, unless the token has changed since.
 * Concurrent callers on one connection share a single refresh.
 */
export async function ensureGrokToken(connection: LoadedConnection, { rejectedToken }: { rejectedToken?: string } = {}): Promise<void> {
    if (rejectedToken !== undefined && connection.env[TOKEN_KEY] && connection.env[TOKEN_KEY] !== rejectedToken) return
    if (rejectedToken === undefined) {
        if (isFresh(connection.env)) return
        const failedAt = lastFailedAt.get(connection.id)
        if (failedAt !== undefined && Date.now() - failedAt < FAILED_REFRESH_BACKOFF_MS && stillValid(connection.env)) return
    }
    const pending = inFlight.get(connection.id)
    if (pending) {
        await pending
        if (rejectedToken === undefined || connection.env[TOKEN_KEY] !== rejectedToken) return
    }
    const task = refreshUnderLock(connection, rejectedToken).finally(() => inFlight.delete(connection.id))
    inFlight.set(connection.id, task)
    return task
}

export function grokAccessToken(connection: LoadedConnection): string | undefined {
    return connection.env[TOKEN_KEY] || undefined
}

// What a reconnect or a delete throws away: the next call starts from the tokens on disk.
export function forgetGrokTokenState(connectionId: string): void {
    lastFailedAt.delete(connectionId)
}

async function revoke(token: string, hint: 'refresh_token' | 'access_token'): Promise<void> {
    try {
        const res = await fetch(REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, token_type_hint: hint, client_id: GROK_OAUTH_CLIENT_ID }),
            redirect: 'error',
            signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
        })
        if (!res.ok) logger.warn({ status: res.status, hint }, 'grok token revocation refused')
    } catch (err) {
        logger.warn({ hint, err: err instanceof Error ? err.name : 'unknown' }, 'grok token revocation failed')
    }
}

/**
 * A deleted connection hands its sign-in back to xAI, refresh token first: it is the one that
 * outlives the deletion. Best effort: a revocation that fails never keeps a connection from going.
 */
export async function revokeGrokTokens(env: Record<string, string>): Promise<void> {
    if (env[REFRESH_KEY]) await revoke(env[REFRESH_KEY], 'refresh_token')
    if (env[TOKEN_KEY]) await revoke(env[TOKEN_KEY], 'access_token')
}
