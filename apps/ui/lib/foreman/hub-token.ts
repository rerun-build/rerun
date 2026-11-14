import { createHmac, timingSafeEqual } from 'crypto'

export const FOREMAN_HUB_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

export type ForemanHubClaims = { ws: number; uid?: string; exp: number }

function secret(): string | undefined {
    return process.env.FOREMAN_HUB_TOKEN_SECRET || undefined
}

function sign(key: string, payload: string): string {
    return createHmac('sha256', key).update(payload).digest('base64url')
}

export function mintForemanHubToken(workspaceId: number, userId?: string | null, now = Date.now()): string | null {
    const key = secret()
    if (!key) return null
    const claims: ForemanHubClaims = { ws: workspaceId, ...(userId ? { uid: userId } : {}), exp: now + FOREMAN_HUB_TOKEN_TTL_MS }
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${sign(key, payload)}`
}

export function verifyForemanHubToken(raw: string | null | undefined, workspaceId: number, now = Date.now()): ForemanHubClaims | null {
    const key = secret()
    if (!key || !raw) return null
    const [payload, signature, ...rest] = raw.split('.')
    if (!payload || !signature || rest.length > 0) return null
    const expected = Buffer.from(sign(key, payload))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
    let claims: Partial<ForemanHubClaims>
    try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<ForemanHubClaims>
    } catch {
        return null
    }
    if (claims.ws !== workspaceId || typeof claims.exp !== 'number' || claims.exp <= now) return null
    return { ws: claims.ws, exp: claims.exp, ...(typeof claims.uid === 'string' && claims.uid ? { uid: claims.uid } : {}) }
}

export function foremanHubTokenRequired(): boolean {
    return secret() !== undefined && process.env.FOREMAN_HUB_TOKEN_REQUIRED !== '0'
}
