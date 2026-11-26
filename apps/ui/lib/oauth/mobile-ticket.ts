import type { DesktopShellChannel } from '@rerun/contracts'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

// The in-app browser carries neither the bearer token nor a Supabase session, so the sign-in entry
// point authenticates with a capability instead: signed, two minutes, and scoped to one agent and
// one service. It holds no secret of its own, and nothing it reaches ends up anywhere but a row the
// app claims with its own bearer afterwards, so a leaked ticket can only open a sign-in the user was
// already being shown. `jti` names that row: a ticket is spent the moment its sign-in starts.
// The service is either an account of a catalog app (`key`, its registry key: the bare slug or
// `<slug>@<instanceId>`) or a server registered outside the catalog (`server`, its engine name), or
// an entry of the workspace's Vault (`vaultItem`, with an empty `agentId`), which no coworker may hold yet.
type ConnectSubject = { key: string; server?: undefined; vaultItem?: undefined } | { server: string; key?: undefined; vaultItem?: undefined } | { vaultItem: string; key?: undefined; server?: undefined }
// `desktop` is the channel of the desktop app that asked, whose URL scheme the sign-in returns to;
// absent, it returns to the iOS app.
export type ConnectTicket = { kind: 'ticket'; jti: string; agentId: string; workspaceId: number; userId: string; exp: number; desktop?: DesktopShellChannel } & ConnectSubject

// What the callback authorizes itself with, for the same reason: it runs in that session-less
// browser too. It rides in the OAuth context cookie, which the browser holds, hence the signature.
// It names the same row as the ticket, where the callback leaves what the provider handed over.
export type CallbackGrant = { kind: 'grant'; jti: string; agentId: string; vaultItem?: string; workspaceId: number; userId: string; exp: number; desktop?: DesktopShellChannel }

const TICKET_TTL_MS = 120_000
// The provider's own screens (password, 2FA) sit between start and callback, so the grant lives
// as long as the context cookie does.
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

// A ticket whose claims must not be read by whoever carries it: a device code is enough, before the
// person approves, for anyone holding it to take the sign-in. Encrypted and authenticated with a key
// of its own derived from the same secret, so it never opens as a signed ticket, nor one as it.
const GCM_IV_BYTES = 12
// Node takes a shorter tag than it writes unless told the length, and a 4-byte tag falls to guessing.
const GCM_TAG_BYTES = 16

function privateKey(): Buffer {
    return createHash('sha256').update(`private-ticket:${secret()}`).digest()
}

export function sealPrivate(claims: Record<string, unknown>, ttlMs: number): string {
    const iv = randomBytes(GCM_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', privateKey(), iv, { authTagLength: GCM_TAG_BYTES })
    const body = Buffer.concat([cipher.update(JSON.stringify({ ...claims, exp: Date.now() + ttlMs }), 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.')
}

export function openPrivate<T extends { exp: number }>(raw: string | null | undefined, label: string): T {
    if (!raw) throw new Error(`Missing ${label}`)
    const [iv, tag, body] = raw.split('.').map(part => Buffer.from(part, 'base64url'))
    if (iv?.length !== GCM_IV_BYTES || tag?.length !== GCM_TAG_BYTES || !body?.length) throw new Error(`Invalid ${label}`)
    let claims: T
    try {
        const decipher = createDecipheriv('aes-256-gcm', privateKey(), iv, { authTagLength: GCM_TAG_BYTES })
        decipher.setAuthTag(tag)
        claims = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')) as T
    } catch {
        throw new Error(`Invalid ${label}`)
    }
    if (claims.exp < Date.now()) throw new Error('Sign-in expired, please retry')
    return claims
}

export function mintConnectTicket(ticket: { agentId: string; workspaceId: number; userId: string; desktop?: DesktopShellChannel } & ConnectSubject): string {
    return seal({ ...ticket, kind: 'ticket', jti: randomBytes(16).toString('base64url') }, TICKET_TTL_MS)
}

// The `kind` keeps a grant, signed with the same secret, from opening as a ticket, and the other way round.
export function verifyConnectTicket(raw: string | null): ConnectTicket {
    const ticket = open<ConnectTicket>(raw, 'sign-in ticket')
    if (ticket.kind !== 'ticket' || typeof ticket.jti !== 'string') throw new Error('Invalid sign-in ticket')
    return ticket
}

export function mintCallbackGrant(grant: Omit<CallbackGrant, 'exp' | 'kind'>): string {
    return seal({ ...grant, kind: 'grant' }, GRANT_TTL_MS)
}

// `undefined` is the web flow, where the agent names its workspace (requireAgentWorkspaceId).
export function callbackGrant(ctx: { agentId: string; mobileGrant?: string; vault?: { itemId: string } }): CallbackGrant | undefined {
    if (ctx.mobileGrant === undefined) return undefined
    const grant = open<CallbackGrant>(ctx.mobileGrant, 'sign-in grant')
    if (grant.kind !== 'grant' || grant.agentId !== ctx.agentId || grant.vaultItem !== ctx.vault?.itemId) throw new Error('Invalid sign-in grant')
    return grant
}
