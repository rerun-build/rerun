import { createHmac, timingSafeEqual } from 'crypto'

// Proves a call to /api/hub comes from the foreman: the engine key every coworker of the box holds
// is not enough, since `x-rerun-agent: foreman` opens the account tools. The hub signs one with
// every foreman turn's brief, the engine keeps it in memory only, and the secret never leaves the hub.
// Twelve hours outlive the longest run the turn starts.
export const FOREMAN_HUB_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

// A check-in reads and suggests: its token outlives its run by little, and opens only the hub tools
// that read (FOREMAN_READ_TOOL_NAMES), enforced by /api/hub.
export const FOREMAN_CHECKIN_TOKEN_TTL_MS = 60 * 60 * 1000

// `uid` is the member the turn speaks for, so the hub acts with their access rather than the
// workspace's. A token minted before it existed carries none and still acts as the workspace.
// `scope: 'read'` is a check-in's.
export type ForemanHubScope = 'read'
export type ForemanHubClaims = { ws: number; uid?: string; scope?: ForemanHubScope; exp: number }

function secret(): string | undefined {
    return process.env.FOREMAN_HUB_TOKEN_SECRET || undefined
}

function sign(key: string, payload: string): string {
    return createHmac('sha256', key).update(payload).digest('base64url')
}

export function mintForemanHubToken(workspaceId: number, userId?: string | null, now = Date.now(), scope?: ForemanHubScope): string | null {
    const key = secret()
    if (!key) return null
    const ttl = scope === 'read' ? FOREMAN_CHECKIN_TOKEN_TTL_MS : FOREMAN_HUB_TOKEN_TTL_MS
    const claims: ForemanHubClaims = { ws: workspaceId, ...(userId ? { uid: userId } : {}), ...(scope ? { scope } : {}), exp: now + ttl }
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
    // A scope this hub does not know never reads as no scope at all, which would open everything.
    if (claims.scope !== undefined && claims.scope !== 'read') return null
    return { ws: claims.ws, exp: claims.exp, ...(typeof claims.uid === 'string' && claims.uid ? { uid: claims.uid } : {}), ...(claims.scope === 'read' ? { scope: 'read' as const } : {}) }
}

// Required as soon as the hub holds a secret to sign with. Without one (a local hub) a foreman call
// carrying no token is let through, and logged. FOREMAN_HUB_TOKEN_REQUIRED=0 restores that tolerance
// on a hub that has the secret, for a fleet whose engines do not forward the token yet.
export function foremanHubTokenRequired(): boolean {
    return secret() !== undefined && process.env.FOREMAN_HUB_TOKEN_REQUIRED !== '0'
}
