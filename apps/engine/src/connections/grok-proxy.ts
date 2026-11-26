import { randomUUID } from 'node:crypto'
import { GROK_CLIENT_VERSION, GROK_PROXY_BASE_URL } from '@rerun/contracts'
import { logger } from '../lib/logger.js'
import { ensureGrokToken, grokAccessToken } from './grok-token.js'
import type { LoadedConnection } from './types.js'

type FetchFunction = typeof globalThis.fetch

const GROK_PROXY_ORIGIN = new URL(GROK_PROXY_BASE_URL).origin

// What the proxy reads off a request beyond the token, as Grok Build sends it in headless mode:
// `x-grok-conv-id` keys its prompt cache on the conversation, `x-grok-req-id` names one request.
// The client identifier is Rerun's own: the proxy accepts it, and xAI can tell the traffic apart.
const GROK_STATIC_HEADERS = {
    'x-grok-client-surface': 'headless',
    'x-grok-client-identifier': 'rerun',
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-authenticateresponse': 'authenticate-response',
} as const

let clientVersion = GROK_CLIENT_VERSION

function newerVersion(candidate: string, current: string): boolean {
    const a = candidate.split('.').map(Number)
    const b = current.split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0)
        if (diff !== 0) return diff > 0
    }
    return false
}

// "Your Grok CLI version (1.0.12) is outdated. Please update to version 1.0.13 or later via …"
export function minimumClientVersionOf(refusal: string): string | null {
    return /update to version (\d+\.\d+\.\d+)/i.exec(refusal)?.[1] ?? null
}

export function grokClientVersion(): string {
    return clientVersion
}

export function resetGrokClientVersionForTests(): void {
    clientVersion = GROK_CLIENT_VERSION
}

export type GrokRequestContext = { connection: LoadedConnection; sessionId: string }

/**
 * Every request of a Grok run, whoever makes it (the SDK, a retry of its own): the token is read
 * from the connection at the moment it leaves, so a refresh in the middle of a long run serves the
 * next step. Only the proxy is ever called, and a redirect is refused rather than followed with
 * the token. A 401 forces one refresh and one more try; a 426 takes up the version the proxy asks
 * for and tries once more. Neither the token nor a body is ever logged.
 */
export function grokFetch({ connection, sessionId }: GrokRequestContext, inner: FetchFunction = fetch): FetchFunction {
    return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.origin !== GROK_PROXY_ORIGIN) throw new Error(`A Grok request may only go to ${GROK_PROXY_ORIGIN}`)
        await ensureGrokToken(connection)

        const send = (token: string | undefined) => {
            const headers = new Headers(init?.headers)
            headers.set('Authorization', `Bearer ${token ?? ''}`)
            for (const [name, value] of Object.entries(GROK_STATIC_HEADERS)) headers.set(name, value)
            headers.set('x-grok-client-version', clientVersion)
            headers.set('x-grok-conv-id', sessionId)
            headers.set('x-grok-req-id', randomUUID())
            return inner(url, { ...init, headers, redirect: 'error' })
        }

        let token = grokAccessToken(connection)
        let response = await send(token)
        if (response.status === 401) {
            await response.body?.cancel()
            await ensureGrokToken(connection, { rejectedToken: token ?? '' })
            token = grokAccessToken(connection)
            response = await send(token)
        }
        if (response.status === 426) {
            const wanted = minimumClientVersionOf(await response.clone().text())
            if (wanted && newerVersion(wanted, clientVersion)) {
                logger.warn({ from: clientVersion, to: wanted }, 'grok proxy asks for a newer client version: taken up')
                clientVersion = wanted
                await response.body?.cancel()
                response = await send(token)
            }
        }
        return response
    }
}
