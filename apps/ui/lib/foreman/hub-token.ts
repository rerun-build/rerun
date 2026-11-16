import { createHmac, timingSafeEqual } from 'crypto'

// Proves a call to /api/hub comes from the foreman: the engine key every coworker of the box holds
// is not enough, since `x-rerun-agent: foreman` opens the account tools. The hub signs one with
// every foreman turn's brief, the engine keeps it in memory only, and the secret never leaves the hub.
// Twelve hours outlive the longest run the turn starts.
export const FOREMAN_HUB_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

// A run the Chief of Staff starts on its own reads and proposes, nothing more: its token says so,
// and lives one hour, long enough for the run and no longer.
export const FOREMAN_WAKE_TOKEN_TTL_MS = 60 * 60 * 1000

// `uid` is the member the turn speaks for, so the hub acts with their access rather than the
// workspace's. A token minted before it existed carries none and still acts as the workspace.
// `scope: 'wake'` limits it to the tools a run nobody started may call.
export type ForemanHubClaims = { ws: number; uid?: string; exp: number; scope?: 'wake' }

function secret(): string | undefined {
    return process.env.FOREMAN_HUB_TOKEN_SECRET || undefined
}

function sign(key: string, payload: string): string {
    return createHmac('sha256', key).update(payload).digest('base64url')
}

function mint(claims: ForemanHubClaims): string | null {
    const key = secret()
    if (!key) return null
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${sign(key, payload)}`
}

export function mintForemanHubToken(workspaceId: number, userId?: string | null, now = Date.now()): string | null {
    return mint({ ws: workspaceId, ...(userId ? { uid: userId } : {}), exp: now + FOREMAN_HUB_TOKEN_TTL_MS })
}

export function mintForemanWakeToken(workspaceId: number, userId: string, now = Date.now()): string | null {
    return mint({ ws: workspaceId, uid: userId, exp: now + FOREMAN_WAKE_TOKEN_TTL_MS, scope: 'wake' })
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
    return { ws: claims.ws, exp: claims.exp, ...(typeof claims.uid === 'string' && claims.uid ? { uid: claims.uid } : {}), ...(claims.scope === 'wake' ? { scope: 'wake' as const } : {}) }
}

// Required as soon as the hub holds a secret to sign with. Without one (a local hub) a foreman call
// carrying no token is let through, and logged. FOREMAN_HUB_TOKEN_REQUIRED=0 restores that tolerance
// on a hub that has the secret, for a fleet whose engines do not forward the token yet.
export function foremanHubTokenRequired(): boolean {
    return secret() !== undefined && process.env.FOREMAN_HUB_TOKEN_REQUIRED !== '0'
}
