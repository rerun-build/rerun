import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

function signedWith(key: string, payload: string, signature: string | undefined): boolean {
    if (!signature) return false
    const expected = Buffer.from(createHmac('sha256', key).update(payload).digest('base64url'))
    const given = Buffer.from(signature)
    return expected.length === given.length && timingSafeEqual(expected, given)
}

// A WebSocket cannot carry a bearer header from a browser, and the box key must never leave the
// hub. The hub signs a short ticket with that key instead, `<base64url claims>.<hmac>`, and it rides
// in the query string. The claims of a ticket that is signed and not expired, or null. An engine
// that runs without a key skips the signature, like its HTTP API skips the bearer.
export function readSignedTicket(raw: string | null | undefined, now: number = Date.now()): Record<string, unknown> | null {
    const [payload, signature] = (raw ?? '').split('.')
    if (!payload) return null
    const key = env().RERUN_API_KEY
    if (key && !signedWith(key, payload, signature)) return null
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
        if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null
        const { exp } = claims as { exp?: unknown }
        if (typeof exp !== 'number' || exp < now) return null
        return claims as Record<string, unknown>
    } catch {
        return null
    }
}
