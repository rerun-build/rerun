import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ site: null as unknown, origins: new Map<string, string>() }))
vi.mock('@/lib/app-url', () => ({ APP_URL: 'https://app.rerun.build' }))
vi.mock('@/lib/brand/request-site', () => ({ requestSite: async () => mocks.site }))
vi.mock('@/lib/brand/site', () => ({ organizationOfOrigin: async (origin: string) => (mocks.origins.has(origin) ? { organizationId: mocks.origins.get(origin) } : null) }))

const { openHostResult, openHostTicket, requestHostReturn, returnToHost, startOnRerunHost } = await import('./host-sign-in')
const { seal } = await import('./mobile-ticket')

const ORIGIN = 'https://nordlys.rerun.work'
const OWNER = { agentId: 'agent-1', workspaceId: 7, userId: 'user-1' }
const TARGET = { flow: 'managed' as const, provider: 'google', key: 'gmail', serverName: 'gmail' }

beforeEach(() => {
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    mocks.site = { kind: 'organization', organizationId: 'org-n' }
    mocks.origins = new Map([[ORIGIN, 'org-n'], ['https://havre.rerun.work', 'org-h']])
})
afterEach(() => vi.unstubAllEnvs())

// The popup's whole trip, as the browser that started it holds it.
async function started() {
    const from = await requestHostReturn(new Request(`${ORIGIN}/api/oauth/managed/google/start`, { headers: { host: 'nordlys.rerun.work', 'x-forwarded-proto': 'https' } }))
    const res = startOnRerunHost(from!, OWNER, TARGET)
    const { authorizationUrl } = (await res.json()) as { authorizationUrl: string }
    const cookie = res.cookies.getAll()[0]
    return { authorizationUrl, cookie }
}

describe('a sign-in started on an organization’s address', () => {
    it('goes to Rerun’s address with a ticket, and leaves a nonce for the way back only', async () => {
        const { authorizationUrl, cookie } = await started()
        const url = new URL(authorizationUrl)
        expect(url.origin + url.pathname).toBe('https://app.rerun.build/api/oauth/host/start')
        expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/oauth/claim' })
        const back = await openHostTicket(url.searchParams.get('t'))
        expect(back).toMatchObject({ ...OWNER, organizationId: 'org-n', origin: ORIGIN, target: TARGET })
        expect(JSON.stringify(back)).not.toContain(cookie.value)
    })

    it('starts where it is on Rerun’s address', async () => {
        mocks.site = { kind: 'rerun' }
        expect(await requestHostReturn(new Request('https://app.rerun.build/x'))).toBeNull()
    })

    it('refuses a ticket of another kind, a forged one and one for an address no longer served', async () => {
        const { authorizationUrl } = await started()
        const ticket = new URL(authorizationUrl).searchParams.get('t')!
        await expect(openHostTicket(seal({ kind: 'ticket', back: {} }, 60_000))).rejects.toThrow()
        await expect(openHostTicket(`${ticket.split('.')[0]}.forged`)).rejects.toThrow()
        mocks.origins.delete(ORIGIN)
        await expect(openHostTicket(ticket)).rejects.toThrow()
    })
})

describe('the way back', () => {
    async function result(outcome: { ok: true; claim: string } | { ok: false; error: string }) {
        const { authorizationUrl, cookie } = await started()
        const back = await openHostTicket(new URL(authorizationUrl).searchParams.get('t'))
        const res = await returnToHost(back, outcome)
        return { location: new URL(res.headers.get('location')!), cookie, back }
    }

    it('leads to the organization’s own address, never anywhere the request named', async () => {
        const { location } = await result({ ok: true, claim: 'claim-1' })
        expect(location.origin + location.pathname).toBe(`${ORIGIN}/api/oauth/claim`)
    })

    it('opens only in the browser that holds the nonce, on the origin it started on', async () => {
        const { location, cookie } = await result({ ok: true, claim: 'claim-1' })
        const raw = location.searchParams.get('r')
        const nonceOf = (value?: string) => (name: string) => (name === cookie.name ? value : undefined)
        expect(openHostResult(raw, ORIGIN, nonceOf(cookie.value)).outcome).toEqual({ ok: true, claim: 'claim-1' })
        expect(() => openHostResult(raw, ORIGIN, nonceOf(undefined))).toThrow()
        expect(() => openHostResult(raw, ORIGIN, nonceOf('another-nonce'))).toThrow()
        expect(() => openHostResult(raw, 'https://havre.rerun.work', nonceOf(cookie.value))).toThrow()
        expect(() => openHostResult(`${raw!.split('.')[0]}.forged`, ORIGIN, nonceOf(cookie.value))).toThrow()
    })

    it('carries a refusal back too', async () => {
        const { location, cookie } = await result({ ok: false, error: 'access_denied' })
        expect(openHostResult(location.searchParams.get('r'), ORIGIN, name => (name === cookie.name ? cookie.value : undefined)).outcome).toEqual({ ok: false, error: 'access_denied' })
    })

    it('goes nowhere once the address is no longer the organization’s', async () => {
        const { authorizationUrl } = await started()
        const back = await openHostTicket(new URL(authorizationUrl).searchParams.get('t'))
        mocks.origins.set(ORIGIN, 'org-h')
        await expect(returnToHost(back, { ok: true, claim: 'x' })).rejects.toThrow()
    })

    it('expires', async () => {
        const { location, cookie } = await result({ ok: true, claim: 'claim-1' })
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 121_000 })
        expect(() => openHostResult(location.searchParams.get('r'), ORIGIN, name => (name === cookie.name ? cookie.value : undefined))).toThrow()
        vi.useRealTimers()
    })
})
