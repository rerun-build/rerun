import type { DesktopShellChannel } from '@rerun/contracts'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

type ConnectSubject = { key: string; server?: undefined } | { server: string; key?: undefined }
export type ConnectTicket = { kind: 'ticket'; jti: string; agentId: string; workspaceId: number; userId: string; exp: number; desktop?: DesktopShellChannel } & ConnectSubject

export type CallbackGrant = { kind: 'grant'; jti: string; agentId: string; workspaceId: number; userId: string; exp: number; desktop?: DesktopShellChannel }

const TICKET_TTL_MS = 120_000
export const GRANT_TTL_MS = 600_000

function secret(): string {
    const value = process.env.MOBILE_OAUTH_TICKET_SECRET
    if (!value) throw new Error('MOBILE_OAUTH_TICKET_SECRET is not configured on this server.')
    return value
}

function sign(payload: string): string {
    return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function seal(claims: Record<string, unknown>, ttlMs: number): string {
    const payload = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() + ttlMs })).toString('base64url')
    return `${payload}.${sign(payload)}`
}

export function open<T extends { exp: number }>(raw: string | null | undefined, label: string): T {
    const [payload, signature] = (raw ?? '').split('.')
    if (!payload || !signature) throw new Error(`Missing ${label}`)
    const expected = Buffer.from(sign(payload))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error(`Invalid ${label}`)
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T
    if (claims.exp < Date.now()) throw new Error('Sign-in expired, please retry')
    return claims
}

export function mintConnectTicket(ticket: { agentId: string; workspaceId: number; userId: string; desktop?: DesktopShellChannel } & ConnectSubject): string {
    return seal({ ...ticket, kind: 'ticket', jti: randomBytes(16).toString('base64url') }, TICKET_TTL_MS)
}

export function verifyConnectTicket(raw: string | null): ConnectTicket {
    const ticket = open<ConnectTicket>(raw, 'sign-in ticket')
    if (ticket.kind !== 'ticket' || typeof ticket.jti !== 'string') throw new Error('Invalid sign-in ticket')
    return ticket
}

export function mintCallbackGrant(grant: Omit<CallbackGrant, 'exp' | 'kind'>): string {
    return seal({ ...grant, kind: 'grant' }, GRANT_TTL_MS)
}

export function callbackGrant(ctx: { agentId: string; mobileGrant?: string }): CallbackGrant | undefined {
    if (ctx.mobileGrant === undefined) return undefined
    const grant = open<CallbackGrant>(ctx.mobileGrant, 'sign-in grant')
    if (grant.kind !== 'grant' || grant.agentId !== ctx.agentId) throw new Error('Invalid sign-in grant')
    return grant
}
