import { SESSION_HINT_COOKIE, SESSION_HINT_MAX_AGE, SESSION_HINT_VALUE } from '@rerun/contracts'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type CookieToSet = { name: string; value: string; options: Record<string, unknown> }

const AUTH_COOKIE = 'sb-test-auth-token'
const SET_OPTIONS = { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 400 * 24 * 60 * 60 }

const mocks = vi.hoisted(() => ({
    setAll: null as ((cookies: CookieToSet[]) => void) | null,
    getUser: vi.fn(),
    signOut: vi.fn(),
    selectMaybeSingle: vi.fn(),
}))

// The JWT the request carries says what the auth server would: same refresh, same user.
const getClaims = vi.fn(async () => {
    const { data } = await mocks.getUser()
    return { data: data.user ? { claims: { sub: data.user.id, is_anonymous: data.user.is_anonymous } } : null, error: null }
})

vi.mock('@supabase/ssr', () => ({
    createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: CookieToSet[]) => void } }) => {
        mocks.setAll = options.cookies.setAll
        return { auth: { getUser: mocks.getUser, getClaims, signOut: mocks.signOut } }
    },
}))

vi.mock('./serviceRole', () => ({ createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: async () => ({}) }) }) }) }))

vi.mock('./supabase-helpers', () => ({ selectMaybeSingle: mocks.selectMaybeSingle }))

const { arrivesByInvite, isPublicPath, provisioningNeeded, updateSession } = await import('./middleware')

const DOCUMENT = { 'sec-fetch-dest': 'document' }
// What a navigation looks like from a browser older than Sec-Fetch-Dest (Safari before 16.4).
const LEGACY_NAVIGATION = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }

function signedInUserRefreshing(cookies: CookieToSet[]) {
    return async () => {
        mocks.setAll?.(cookies)
        return { data: { user: { id: 'user-1', is_anonymous: false } } }
    }
}

describe('updateSession', () => {
    beforeEach(() => {
        mocks.getUser.mockReset()
        mocks.signOut.mockReset().mockResolvedValue({ error: null })
        getClaims.mockClear()
        mocks.selectMaybeSingle.mockReset().mockResolvedValue({ data: { id: 'user-1', workspace_id: 'workspace-1', signed_up_at: '2026-01-01T00:00:00Z' }, error: null })
    })

    describe('session check', () => {
        it('asks the auth server on a page load, where a revoked session has to be caught', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            await updateSession(new NextRequest('https://app.rerun.build/board', { headers: { ...DOCUMENT, cookie: 'rerun-provisioned=user-1.1' } }))

            expect(mocks.getUser).toHaveBeenCalledTimes(1)
            expect(getClaims).not.toHaveBeenCalled()
        })

        it('reads the JWT locally on anything else, and asks nothing more of a provisioned account', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            await updateSession(new NextRequest('https://app.rerun.build/board', { method: 'POST', headers: { cookie: 'rerun-provisioned=user-1.1' } }))

            expect(getClaims).toHaveBeenCalledTimes(1)
            expect(mocks.getUser).toHaveBeenCalledTimes(1)
            expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
        })
    })

    describe('provisioning', () => {
        it('provisions an account it has no cookie for, then remembers it', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })

            const response = await updateSession(new NextRequest('https://app.rerun.build/board', { method: 'POST' }))

            expect(mocks.selectMaybeSingle).toHaveBeenCalledTimes(1)
            expect(response.cookies.get('rerun-provisioned')?.value).toBe('user-1.1')
            expect(response.cookies.get('rerun-provisioned')?.httpOnly).toBe(true)
        })

        it('leaves no cookie when the provisioning read failed, so the next request tries again', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: false } } })
            mocks.selectMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
            vi.spyOn(console, 'error').mockImplementation(() => {})

            const response = await updateSession(new NextRequest('https://app.rerun.build/board', { method: 'POST' }))

            expect(response.cookies.get('rerun-provisioned')).toBeUndefined()
        })
    })

    it('keeps the cookie options supabase asked for, so a refreshed token is not downgraded to a session cookie', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

        const response = await updateSession(new NextRequest('https://app.rerun.build/board'))

        expect(response.cookies.get(AUTH_COOKIE)?.maxAge).toBe(SET_OPTIONS.maxAge)
    })

    it('expires a chunk supabase asked to remove instead of leaving an empty cookie behind', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: `${AUTH_COOKIE}.1`, value: '', options: { ...SET_OPTIONS, maxAge: 0 } }]))

        const response = await updateSession(new NextRequest('https://app.rerun.build/board'))

        expect(response.cookies.get(`${AUTH_COOKIE}.1`)?.maxAge).toBe(0)
    })

    it('carries the refreshed cookies over to the redirect that bounces a signed-in user off /auth', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

        const response = await updateSession(new NextRequest('https://app.rerun.build/auth'))

        expect(response.headers.get('location')).toBe('https://app.rerun.build/')
        expect(response.cookies.get(AUTH_COOKIE)?.value).toBe('refreshed')
        expect(response.cookies.get(AUTH_COOKIE)?.maxAge).toBe(SET_OPTIONS.maxAge)
    })

    it('lets a signed-in user reach the callback, where connecting Google ends', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([]))

        const response = await updateSession(new NextRequest('https://app.rerun.build/auth/callback?code=abc'))

        expect(response.headers.get('location')).toBeNull()
    })

    describe('session hint', () => {
        it('tells the landing a real user is signed in, on the parent domain', async () => {
            mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

            const response = await updateSession(new NextRequest('https://app.rerun.build/board', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)?.value).toBe(SESSION_HINT_VALUE)
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.domain).toBe('.rerun.build')
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.maxAge).toBe(SESSION_HINT_MAX_AGE)
        })

        it('says nothing about a leftover anonymous session, which never signed up', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', is_anonymous: true } } })

            const response = await updateSession(new NextRequest('https://app.rerun.build/board', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })

        it('expires a hint left behind once the session is gone', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: null } })

            const response = await updateSession(
                new NextRequest('https://app.rerun.build/auth', { headers: { ...DOCUMENT, cookie: `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}` } }),
            )

            expect(response.cookies.get(SESSION_HINT_COOKIE)?.maxAge).toBe(0)
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.domain).toBe('.rerun.build')
        })

        it('leaves a visitor who never had a hint alone', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: null } })

            const response = await updateSession(new NextRequest('https://app.rerun.build/auth', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })

        it('survives the redirect that bounces a signed-in user off /auth', async () => {
            mocks.getUser.mockImplementation(signedInUserRefreshing([{ name: AUTH_COOKIE, value: 'refreshed', options: SET_OPTIONS }]))

            const response = await updateSession(new NextRequest('https://app.rerun.build/auth', { headers: DOCUMENT }))

            expect(response.cookies.get(SESSION_HINT_COOKIE)?.value).toBe(SESSION_HINT_VALUE)
            expect(response.cookies.get(SESSION_HINT_COOKIE)?.domain).toBe('.rerun.build')
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
                new NextRequest('https://app.rerun.build/', { method: 'POST', headers: { 'next-action': 'abc123', cookie: 'rerun-provisioned=user-1.1' } }),
            )

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })

        it('does not expire a stale hint on a server action either, only a page load does', async () => {
            mocks.getUser.mockResolvedValue({ data: { user: null } })

            const response = await updateSession(
                new NextRequest('https://app.rerun.build/', { method: 'POST', headers: { 'next-action': 'abc123', cookie: `${SESSION_HINT_COOKIE}=${SESSION_HINT_VALUE}` } }),
            )

            expect(response.cookies.get(SESSION_HINT_COOKIE)).toBeUndefined()
        })
    })

    describe('leftover anonymous session', () => {
        beforeEach(() => mocks.getUser.mockResolvedValue({ data: { user: { id: 'anon-1', is_anonymous: true } } }))

        it('is closed on its next page load, which goes to the sign-in like any visitor', async () => {
            const response = await updateSession(new NextRequest('https://app.rerun.build/', { headers: DOCUMENT }))

            expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
            expect(response.headers.get('location')).toBe('https://app.rerun.build/auth')
            expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
        })

        it('is let onto the sign-in, signed out', async () => {
            const response = await updateSession(new NextRequest('https://app.rerun.build/auth', { headers: DOCUMENT }))

            expect(mocks.signOut).toHaveBeenCalledOnce()
            expect(response.headers.get('location')).toBeNull()
        })

        it('is never provisioned from a JWT read locally', async () => {
            await updateSession(new NextRequest('https://app.rerun.build/', { method: 'POST', headers: { 'next-action': 'abc123' } }))

            expect(mocks.selectMaybeSingle).not.toHaveBeenCalled()
            expect(mocks.signOut).not.toHaveBeenCalled()
        })

        it('is closed for a browser that does not say where its request is headed', async () => {
            const response = await updateSession(new NextRequest('https://app.rerun.build/', { headers: LEGACY_NAVIGATION }))

            expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
            expect(response.headers.get('location')).toBe('https://app.rerun.build/auth')
        })
    })

    describe('visitor without a session', () => {
        beforeEach(() => mocks.getUser.mockResolvedValue({ data: { user: null } }))

        it('is sent to the sign-in from the home page', async () => {
            const response = await updateSession(new NextRequest('https://app.rerun.build/', { headers: DOCUMENT }))

            expect(response.headers.get('location')).toBe('https://app.rerun.build/auth')
        })

        it('is sent to the sign-in from any page of the app, with where it was going', async () => {
            const settings = await updateSession(new NextRequest('https://app.rerun.build/settings', { headers: DOCUMENT }))
            const welcome = await updateSession(new NextRequest('https://app.rerun.build/welcome', { headers: DOCUMENT }))

            expect(settings.headers.get('location')).toBe('https://app.rerun.build/auth?next=%2Fsettings')
            expect(welcome.headers.get('location')).toBe('https://app.rerun.build/auth?next=%2Fwelcome')
        })

        it('keeps what a link carried, a template, a share or a prompt, through the sign-in', async () => {
            const response = await updateSession(new NextRequest('https://app.rerun.build/?template=crm&purchase=1', { headers: DOCUMENT }))

            const location = new URL(response.headers.get('location') ?? '')
            expect(location.pathname).toBe('/auth')
            expect(location.searchParams.get('next')).toBe('/?template=crm&purchase=1')
        })

        it('opens the pages that bring someone to the sign-in, or let them leave', async () => {
            for (const path of ['/auth', '/auth/confirm?token_hash=x', '/invite/abc', '/creator/join', '/creator/join/abc', '/redeem', '/unsubscribe?token=x']) {
                const response = await updateSession(new NextRequest(`https://app.rerun.build${path}`, { headers: DOCUMENT }))
                expect(response.headers.get('location'), path).toBeNull()
            }
        })

        it('is never redirected off a server action, an RSC fetch or an API call, which answer for themselves', async () => {
            const action = await updateSession(new NextRequest('https://app.rerun.build/', { method: 'POST', headers: { 'next-action': 'abc123' } }))
            const rsc = await updateSession(new NextRequest('https://app.rerun.build/settings', { headers: { 'sec-fetch-dest': 'empty' } }))

            expect(action.headers.get('location')).toBeNull()
            expect(rsc.headers.get('location')).toBeNull()
        })

        it('is sent to the sign-in by a browser that does not say where its request is headed', async () => {
            const home = await updateSession(new NextRequest('https://app.rerun.build/', { headers: LEGACY_NAVIGATION }))
            const settings = await updateSession(new NextRequest('https://app.rerun.build/settings', { headers: LEGACY_NAVIGATION }))

            expect(home.headers.get('location')).toBe('https://app.rerun.build/auth')
            expect(settings.headers.get('location')).toBe('https://app.rerun.build/auth?next=%2Fsettings')
        })

        it('leaves what such a browser fetches alone: the router asks for anything, a form posts', async () => {
            const fetched = await updateSession(new NextRequest('https://app.rerun.build/settings', { headers: { accept: '*/*' } }))
            const posted = await updateSession(new NextRequest('https://app.rerun.build/settings', { method: 'POST', headers: LEGACY_NAVIGATION }))
            const modernFetch = await updateSession(new NextRequest('https://app.rerun.build/settings', { headers: { ...LEGACY_NAVIGATION, 'sec-fetch-dest': 'empty' } }))

            for (const response of [fetched, posted, modernFetch]) expect(response.headers.get('location')).toBeNull()
        })
    })

    it('sends a signed-in visit to the sign-in where it was headed, never to another site', async () => {
        mocks.getUser.mockImplementation(signedInUserRefreshing([]))

        const back = await updateSession(new NextRequest('https://app.rerun.build/auth?next=%2F%3Ftemplate%3Dcrm', { headers: DOCUMENT }))
        const away = await updateSession(new NextRequest('https://app.rerun.build/auth?next=%2F%2Fevil.example', { headers: DOCUMENT }))

        expect(back.headers.get('location')).toBe('https://app.rerun.build/?template=crm')
        expect(away.headers.get('location')).toBe('https://app.rerun.build/')
    })
})

describe('isPublicPath', () => {
    it('opens the sign-in and the doors to it, and nothing that merely starts like them', () => {
        expect(isPublicPath('/auth')).toBe(true)
        expect(isPublicPath('/auth/callback')).toBe(true)
        expect(isPublicPath('/invite/abc')).toBe(true)
        expect(isPublicPath('/')).toBe(false)
        expect(isPublicPath('/welcome')).toBe(false)
        expect(isPublicPath('/authors')).toBe(false)
        expect(isPublicPath('/redeemed')).toBe(false)
    })
})

describe('provisioningNeeded', () => {
    const account = { id: 'user-1' }

    it('provisions whoever the cookie does not name', () => {
        expect(provisioningNeeded(undefined, account)).toBe(true)
        expect(provisioningNeeded('user-2.1', account)).toBe(true)
    })

    it('runs again for an account whose signup is not stamped yet', () => {
        expect(provisioningNeeded('user-1.0', account)).toBe(true)
        expect(provisioningNeeded('user-1.1', account)).toBe(false)
    })
})

describe('arrivesByInvite', () => {
    const request = (path: string, cookie?: string) => new NextRequest(`https://app.rerun.build${path}`, { headers: cookie ? { cookie } : undefined })

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
