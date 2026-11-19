import { SESSION_HINT_COOKIE, SESSION_HINT_MAX_AGE, SESSION_HINT_VALUE } from '@moldwright/contracts'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type CookieToSet = { name: string; value: string; options: Record<string, unknown> }

const AUTH_COOKIE = 'sb-test-auth-token'
const SET_OPTIONS = { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 400 * 24 * 60 * 60 }

const mocks = vi.hoisted(() => ({
    setAll: null as ((cookies: CookieToSet[]) => void) | null,
    getUser: vi.fn(),
    signInAnonymously: vi.fn(),
    selectMaybeSingle: vi.fn(),
}))

const getClaims = vi.fn(async () => {
    const { data } = await mocks.getUser()
    return { data: data.user ? { claims: { sub: data.user.id, is_anonymous: data.user.is_anonymous } } : null, error: null }
})

vi.mock('@supabase/ssr', () => ({
    createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: CookieToSet[]) => void } }) => {
        mocks.setAll = options.cookies.setAll
        return { auth: { getUser: mocks.getUser, getClaims, signInAnonymously: mocks.signInAnonymously } }
    },
}))

vi.mock('./serviceRole', () => ({ createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: async () => ({}) }) }) }) }))

vi.mock('./supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle }))

const { arrivesByInvite, provisioningNeeded, updateSession } = await import('./middleware')

const DOCUMENT = { 'sec-fetch-dest': 'document' }

function signedInUserRefreshing(cookies: CookieToSet[]) {
    return async () => {
        mocks.setAll?.(cookies)
        return { data: { user: { id: 'user-1', is_anonymous: false } } }
    }
}

describe('updateSession', () => {
    beforeEach(() => {
        mocks.getUser.mockReset()
        mocks.signInAnonymously.mockReset()
        getClaims.mockClear()
        mocks.selectMaybeSingle.mockReset().mockResolvedValue({ data: { id: 'user-1', workspace_id: 'workspace-1', signed_up_at: '2026-01-01T00:00:00Z' }, error: null })
    })

    describe('session check', () => {
        it('asks the auth server on a page load, where a revoked session has to be caught', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { headers: { ...DOCUMENT, cookie: 'rerun-provisioned=user-1.1' } }))

            expect(mocks.getUser).toHaveBeenCalledTimes(1)
            expect(getClaims).not.toHaveBeenCalled()
        })

        it('reads the JWT locally on anything else, and asks nothing more of a provisioned account', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { method: 'POST', headers: { cookie: 'rerun-provisioned=user-1.1' } }))

            expect(getClaims).toHaveBeenCalledTimes(1)
            expect(mocks.getUser).toHaveBeenCalledTimes(1)
            expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
        })
    })

    describe('provisioning', () => {
        it('provisions an account it has no cookie for, then remembers it', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { method: 'POST' }))

            expect(mocks.selectMaybeSingle).toHaveBeenCalledTimes(1)
            expect(response.cookies.get('rerun-provisioned')?.value).toBe('user-1.1')
            expect(response.cookies.get('rerun-provisioned')?.httpOnly).toBe(true)
        })

        it('leaves no cookie when the provisioning read failed, so the next request tries again', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })
            mocks.selectMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
            vi.spyOn(console, 'error').mockImplementation(() => {})

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { method: 'POST' }))

            expect(response.cookies.get('rerun-provisioned')).toBeUndefined()
        })
    })

    it('keeps the cookie options supabase asked for, so a refreshed token is not downgraded to a session cookie', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

        const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board'))

        expect(response.cookies.get(AUTH_COOKIE)?.maxAge).toBe(SET_OPTIONS.maxAge)
    })

    it('expires a chunk supabase asked to remove instead of leaving an empty cookie behind', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: `${AUTH_COOKIE}.1`, value: '', options: { ...SET_OPTIONS, maxAge: 0 } }]))

        const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board'))

        expect(response.cookies.get(`${AUTH_COOKIE}.1`)?.maxAge).toBe(0)
    })

    it('carries the refreshed cookies over to the redirect that bounces a signed-in user off /auth', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

        const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/auth'))

        expect(response.headers.get('location')).toBe('https://moldwright.robagentic.tech/board')
        expect(response.cookies.get(AUTH_COOKIE)?.value).toBe('refreshed')
        expect(response.cookies.get(AUTH_COOKIE)?.maxAge).toBe(SET_OPTIONS.maxAge)
    })

    it('lets a signed-in user reach the callback, where connecting Google ends', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([]))

        const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/auth/callback?code=abc'))

        expect(response.headers.get('location')).toBeNull()
    })

    describe('session hint', () => {
        it('tells the landing a real user is signed in, on the parent domain', async () => {
            mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)?.value).toBe(SESSION_HINT_VALUE)
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.domain).toBeUndefined()
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.maxAge).toBe(SESSION_HINT_MAX_AGE)
        })

        it('says nothing about an anonymous visitor, who never signed up', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: true } } })

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })

        it('expires a hint left behind once the session is gone', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: null } })

            const response = await updateSession(
                new NextRequest('https://moldwright.robagentic.tech/auth', { headers: { ...DOCUMENT, cookie: `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}` } }),
            )

            expect(response.cookies.get(SESSION_HINT_COOKIE)?.maxAge).toBe(0)
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.domain).toBeUndefined()
        })

        it('leaves a visitor who never had a hint alone', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: null } })

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/auth', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })

        it('survives the redirect that bounces a signed-in user off /auth', async () => {
            mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/auth', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)?.value).toBe(SESSION_HINT_VALUE)
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.domain).toBeUndefined()
        })

        it('stays host-only in local development, where there is no parent domain to share', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            const response = await updateSession(new NextRequest('http://localhost:3050/board', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)?.domain).toBeUndefined()
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.secure).toBe(false)
        })

        it('leaves a server action without the cookie, which would make Next refresh the router after it', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            const response = await updateSession(
                new NextRequest('https://moldwright.robagentic.tech/', { method: 'POST', headers: { 'next-action': 'abc123', cookie: 'rerun-provisioned=user-1.1' } }),
            )

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })

        it('does not expire a stale hint on a server action either, only a page load does', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: null } })

            const response = await updateSession(
                new NextRequest('https://moldwright.robagentic.tech/', { method: 'POST', headers: { 'next-action': 'abc123', cookie: `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}` } }),
            )

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })
    })

    describe('anonymous session', () => {
        beforeEach(() => {
            mocks.getUser.mockResolvedValue({ data: { user: null } })
            mocks.signInAnonymously.mockResolvedValue({ data: { user: { id: 'anon-1', is_anonymous: true } }, error: null })
        })

        it('starts one for a top-level navigation to a page', async () => {
            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { headers: DOCUMENT }))

            expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1)
            expect(response.headers.get('location')).toBeNull()
        })

        it('starts none for a prefetch, an RSC fetch or an asset', async () => {
            await updateSession(new NextRequest('https://moldwright.robagentic.tech/board'))
            await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { headers: { 'sec-fetch-dest': 'empty' } }))

            expect(mocks.signInAnonymously).not.toHaveBeenCalled()
        })

        it('starts none for anything but a GET', async () => {
            await updateSession(new NextRequest('https://moldwright.robagentic.tech/board', { method: 'POST', headers: DOCUMENT }))

            expect(mocks.signInAnonymously).not.toHaveBeenCalled()
        })

        it('starts none on the auth pages, where the visitor is about to sign in', async () => {
            await updateSession(new NextRequest('https://moldwright.robagentic.tech/auth', { headers: DOCUMENT }))
            await updateSession(new NextRequest('https://moldwright.robagentic.tech/auth/callback', { headers: DOCUMENT }))

            expect(mocks.signInAnonymously).not.toHaveBeenCalled()
        })

        it('lets an anonymous visitor stay on /auth to sign in', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'anon-1', is_anonymous: true } } })

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/auth'))

            expect(response.headers.get('location')).toBeNull()
        })
    })

    describe('visitor without a session', () => {
        beforeEach(() => mocks.getUser.mockResolvedValue({ data: { user: null } }))

        it('is sent to /auth from the home page when no anonymous session could be started', async () => {
            mocks.signInAnonymously.mockResolvedValue({ data: { user: null }, error: { message: 'Anonymous sign-ins are disabled' } })
            vi.spyOn(console, 'error').mockImplementation(() => {})

            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/', { headers: { 'sec-fetch-dest': 'document' } }))

            expect(response.headers.get('location')).toBe('https://moldwright.robagentic.tech/auth')
        })

        it('is sent to /auth from the home page on a request that may not start a session', async () => {
            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/'))

            expect(response.headers.get('location')).toBe('https://moldwright.robagentic.tech/auth')
        })

        it('is sent to /auth from the board', async () => {
            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/board'))

            expect(response.headers.get('location')).toBe('https://moldwright.robagentic.tech/auth')
        })

        it('is let through on any other page', async () => {
            const response = await updateSession(new NextRequest('https://moldwright.robagentic.tech/templates/crm'))

            expect(response.headers.get('location')).toBeNull()
        })
    })
})

describe('provisioningNeeded', () => {
    const account = { id: 'user-1', isAnonymous: false }
    const visitor = { id: 'user-1', isAnonymous: true }

    it('provisions whoever the cookie does not name', () => {
        expect(provisioningNeeded(undefined, account)).toBe(true)
        expect(provisioningNeeded('user-2.1', account)).toBe(true)
        expect(provisioningNeeded('user-2.0', visitor)).toBe(true)
    })

    it('leaves an anonymous visitor alone once provisioned', () => {
        expect(provisioningNeeded('user-1.0', visitor)).toBe(false)
    })

    it('runs again for an account whose signup is not stamped yet, the anonymous visitor who just signed up', () => {
        expect(provisioningNeeded('user-1.0', account)).toBe(true)
        expect(provisioningNeeded('user-1.1', account)).toBe(false)
    })
})

describe('arrivesByInvite', () => {
    const request = (path: string, cookie?: string) => new NextRequest(`https://moldwright.robagentic.tech${path}`, { headers: cookie ? { cookie } : undefined })

    it('recognises the invite cookie on its way through /auth', () => {
        expect(arrivesByInvite(request('/', 'pending_invite=/invite/abc'))).toBe(true)
    })

    it('recognises the landing on an invite once the callback has cleared the cookie', () => {
        expect(arrivesByInvite(request('/invite/abc'))).toBe(true)
        expect(arrivesByInvite(request('/creator/join/abc'))).toBe(true)
    })

    it('leaves a plain signup alone', () => {
        expect(arrivesByInvite(request('/'))).toBe(false)
    })
})
