import 'server-only'
import { APP_URL } from '@/lib/app-url'
import { organizationOfOrigin } from '@/lib/brand/site'
import { requestSite } from '@/lib/brand/request-site'
import type { ActionRefusal } from '@/lib/i18n/action-error'
import { requestOrigin } from '@/lib/request-host'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { open, seal } from './mobile-ticket'

// A provider that only knows Rerun's own client sends the browser back to Rerun's own address, whatever
// the address the sign-in was started on. On an organization's, the sign-in goes there and comes back:
// the start leaves a nonce in that host's cookies and hands a signed ticket over to Rerun's address,
// which talks to the provider and parks what it answered; the claim, drawn only then, takes it back to
// the one browser that holds the nonce, where the person has their session.

export const HOST_START_PATH = '/api/oauth/host/start'
export const HOST_CLAIM_PATH = '/api/oauth/claim'

const TICKET_TTL_MS = 120_000
const RESULT_TTL_MS = 120_000
const NONCE_MAX_AGE_SECONDS = 600
const NONCE_COOKIE_PREFIX = 'host_oauth_'

// `vaultItem`: the sign-in is for an entry of the Vault, which no coworker holds yet.
export type HostSignInTarget = { flow: 'managed'; provider: string; key: string; serverName: string; vaultItem?: string } | { flow: 'mcp'; serverName: string; mcpUrl: string; vaultItem?: string }
export type HostSignInOwner = { agentId: string; workspaceId: number; userId: string }

// Where the sign-in goes back to, and what only the browser it started in can answer for.
export type HostReturn = HostSignInOwner & { organizationId: string; origin: string; nonceId: string; nonceHash: string; target: HostSignInTarget }

const hashOf = (nonce: string): string => createHash('sha256').update(nonce).digest('base64url')

type Sealed<Kind extends string, Body> = { kind: Kind; exp: number } & Body

function openAs<Kind extends string, Body>(kind: Kind, raw: string | null, label: string): Sealed<Kind, Body> {
    const sealed = open<Sealed<Kind, Body>>(raw, label)
    if (sealed.kind !== kind) throw new Error(`Invalid ${label}`)
    return sealed
}

// Null on Rerun's own address, where the provider comes straight back.
export async function requestHostReturn(req: Request): Promise<Pick<HostReturn, 'organizationId' | 'origin'> | null> {
    const site = await requestSite()
    return site.kind === 'organization' ? { organizationId: site.organizationId, origin: requestOrigin(req.headers) } : null
}

// Once the caller may connect this. Answers what the popup opens.
export function startOnRerunHost(from: Pick<HostReturn, 'organizationId' | 'origin'>, owner: HostSignInOwner, target: HostSignInTarget): NextResponse {
    const nonce = randomBytes(32).toString('base64url')
    const nonceId = randomBytes(12).toString('base64url')
    const back: HostReturn = { ...owner, ...from, nonceId, nonceHash: hashOf(nonce), target }
    const url = new URL(HOST_START_PATH, APP_URL)
    url.searchParams.set('t', seal({ kind: 'host-ticket', back }, TICKET_TTL_MS))
    const res = NextResponse.json({ authorizationUrl: url.toString() })
    res.cookies.set(NONCE_COOKIE_PREFIX + nonceId, nonce, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: HOST_CLAIM_PATH, maxAge: NONCE_MAX_AGE_SECONDS })
    return res
}

// Still an address of the organization the sign-in was started for: a domain can be let go in between.
async function assertReturns(back: HostReturn): Promise<HostReturn> {
    const organization = await organizationOfOrigin(back.origin)
    if (organization?.organizationId !== back.organizationId) throw new Error('Sign-in expired, please retry')
    return back
}

export async function openHostTicket(raw: string | null): Promise<HostReturn> {
    return assertReturns(openAs<'host-ticket', { back: HostReturn }>('host-ticket', raw, 'sign-in ticket').back)
}

export type HostSignInOutcome = { ok: true; claim: string } | ({ ok: false } & ActionRefusal)

// The way back, with a claim or with why there is none.
export async function returnToHost(back: HostReturn, outcome: HostSignInOutcome): Promise<NextResponse> {
    const { origin } = await assertReturns(back)
    const url = new URL(HOST_CLAIM_PATH, origin)
    url.searchParams.set('r', seal({ kind: 'host-result', back, outcome }, RESULT_TTL_MS))
    return new NextResponse(null, { status: 302, headers: { Location: url.toString(), 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } })
}

export type HostResult = { back: HostReturn; outcome: HostSignInOutcome }

// On the organization's address: the result of a sign-in this very browser started there.
export function openHostResult(raw: string | null, origin: string, nonceOf: (cookieName: string) => string | undefined): HostResult {
    const { back, outcome } = openAs<'host-result', HostResult>('host-result', raw, 'sign-in result')
    const nonce = nonceOf(NONCE_COOKIE_PREFIX + back.nonceId)
    const given = Buffer.from(nonce ? hashOf(nonce) : '')
    const expected = Buffer.from(back.nonceHash)
    if (back.origin !== origin || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('Sign-in expired, please retry')
    return { back, outcome }
}

export function forgetNonce(res: NextResponse, back: HostReturn): NextResponse {
    res.cookies.delete({ name: NONCE_COOKIE_PREFIX + back.nonceId, path: HOST_CLAIM_PATH })
    return res
}
