import { createHmac, timingSafeEqual } from 'node:crypto'

export type AccessGrant = 'member' | 'password' | 'invite' | 'shot'

export type AccessClaims = { slug: string; v: number; grant: AccessGrant; sub: string; exp: number }

type Kind = 'ticket' | 'cookie'

export const ACCESS_TICKET_TTL_MS = 60_000
export const MEMBER_COOKIE_TTL_MS = 12 * 60 * 60_000
export const GUEST_COOKIE_TTL_MS = 7 * 24 * 60 * 60_000

function secret(): string {
    const value = process.env.PUBLISHED_ACCESS_SECRET
    if (!value) throw new Error('PUBLISHED_ACCESS_SECRET is not configured on this server.')
    return value
}

function sign(payload: string): string {
    return createHmac('sha256', secret()).update(payload).digest('base64url')
}

function seal(kind: Kind, claims: Omit<AccessClaims, 'exp'>, ttlMs: number): string {
    const payload = Buffer.from(JSON.stringify({ ...claims, kind, exp: Date.now() + ttlMs })).toString('base64url')
    return `${payload}.${sign(payload)}`
}

function unseal(kind: Kind, raw: string | null | undefined, slug: string): AccessClaims | null {
    const [payload, signature] = (raw ?? '').split('.')
    if (!payload || !signature) return null
    const expected = Buffer.from(sign(payload))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims & { kind?: Kind }
        if (claims.kind !== kind || claims.slug !== slug || typeof claims.v !== 'number' || claims.exp < Date.now()) return null
        return claims
    } catch {
        return null
    }
}

export function cookieTtlMs(grant: AccessGrant): number {
    return grant === 'member' ? MEMBER_COOKIE_TTL_MS : GUEST_COOKIE_TTL_MS
}

export function mintAccessTicket(claims: Omit<AccessClaims, 'exp'>): string {
    return seal('ticket', claims, ACCESS_TICKET_TTL_MS)
}

export function openAccessTicket(raw: string | null | undefined, slug: string): AccessClaims | null {
    return unseal('ticket', raw, slug)
}

export function mintAccessCookie(claims: Omit<AccessClaims, 'exp'>): string {
    return seal('cookie', claims, cookieTtlMs(claims.grant))
}

export function openAccessCookie(raw: string | null | undefined, slug: string): AccessClaims | null {
    return unseal('cookie', raw, slug)
}
