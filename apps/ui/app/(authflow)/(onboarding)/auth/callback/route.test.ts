import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeCodeForSession = vi.fn()
const signInWithOAuth = vi.fn()
const selectMaybeSingle = vi.fn()
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { exchangeCodeForSession, signInWithOAuth } }) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle }))

let requestCookies = new Map<string, string>()
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) => (requestCookies.has(name) ? { name, value: requestCookies.get(name) } : undefined),
        has: (name: string) => requestCookies.has(name),
        getAll: () => [...requestCookies].map(([name, value]) => ({ name, value })),
    }),
}))

const { GET } = await import('./route')

const callback = (query: string) => GET(new Request(`https://app.rerun.build/auth/callback${query}`))

const NOW = new Date('2026-10-16T10:30:00.000Z')

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    requestCookies = new Map()
    exchangeCodeForSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token', user: { id: 'user-1' } } }, error: null })
    selectMaybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
    signInWithOAuth.mockReset().mockResolvedValue({ data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' }, error: null })
})

afterEach(() => {
    vi.useRealTimers()
})

describe('GET /auth/callback', () => {
    it('sends a sign-in home', async () => {
        const response = await callback('?code=abc')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/')
    })

    it('sends a sign-in that came from an invitation back to it', async () => {
        requestCookies.set('pending_invite', '/invite/token-1')

        const response = await callback('?code=abc')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/invite/token-1')
    })

    it('remembers Google as the last way in', async () => {
        requestCookies.set('rr_oauth_provider', 'google')

        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_last_sign_in')?.value).toBe('google')
    })

    it('remembers Apple as the last way in', async () => {
        requestCookies.set('rr_oauth_provider', 'apple')

        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_last_sign_in')?.value).toBe('apple')
    })

    it('does not remember a provider connected from the account settings', async () => {
        requestCookies.set('rr_link_intent', 'apple')
        requestCookies.set('rr_oauth_provider', 'apple')

        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_last_sign_in')).toBeUndefined()
    })

    it('does not remember a sign-in whose provider cookie is gone', async () => {
        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_last_sign_in')).toBeUndefined()
    })

    it('does not remember a sign-in that failed', async () => {
        requestCookies.set('rr_oauth_provider', 'apple')

        const response = await callback('?error=access_denied')

        expect(response.cookies.get('rr_last_sign_in')).toBeUndefined()
    })

    it('sends a failed sign-in to the expired link page', async () => {
        const response = await callback('?error=access_denied')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/auth/auth-code-error')
    })

    it('sends a failed sign-in to the public host when the request reached it through the proxy', async () => {
        const response = await GET(new Request('http://localhost:8080/auth/callback?error=access_denied', { headers: { 'x-forwarded-host': 'app.rerun.build' } }))

        expect(response.headers.get('location')).toBe('https://app.rerun.build/auth/auth-code-error')
    })

    it('signs a visitor into the account their Google identity already belongs to', async () => {
        const response = await callback('?error=server_error&error_code=identity_already_exists')

        expect(signInWithOAuth).toHaveBeenCalledWith({
            provider: 'google',
            options: { redirectTo: 'https://app.rerun.build/auth/callback', queryParams: { access_type: 'offline' } },
        })
        expect(response.headers.get('location')).toBe('https://project.supabase.co/auth/v1/authorize?provider=google')
    })

    it('signs a visitor into the account their Apple identity already belongs to', async () => {
        requestCookies.set('rr_oauth_provider', 'apple')

        await callback('?error=server_error&error_code=identity_already_exists')

        expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'apple', options: { redirectTo: 'https://app.rerun.build/auth/callback' } })
    })

    it('restarts Google when the provider cookie holds something unknown', async () => {
        requestCookies.set('rr_oauth_provider', 'facebook')

        await callback('?error=server_error&error_code=identity_already_exists')

        expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }))
    })

    it('sends a sign-in that could not be restarted to the expired link page', async () => {
        signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: 'nope' } })

        const response = await callback('?error=server_error&error_code=identity_already_exists')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/auth/auth-code-error')
    })

    it('brings a Google connection back to the account settings, and forgets the intent', async () => {
        requestCookies.set('rr_link_intent', 'google')

        const response = await callback('?code=abc')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/?account=sign-in')
        expect(response.cookies.get('rr_link_intent')?.value).toBe('')
    })

    it('brings a refused Google connection back with the reason', async () => {
        requestCookies.set('rr_link_intent', 'google')

        const response = await callback('?error=server_error&error_code=identity_already_exists')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/?account=sign-in&link_error=identity_already_exists&link_provider=google')
        expect(exchangeCodeForSession).not.toHaveBeenCalled()
        expect(signInWithOAuth).not.toHaveBeenCalled()
    })

    it('names Apple when an Apple connection was refused', async () => {
        requestCookies.set('rr_link_intent', 'apple')

        const response = await callback('?error=access_denied&error_code=access_denied')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/?account=sign-in&link_error=access_denied&link_provider=apple')
    })

    it('brings a Google connection whose code could not be exchanged back with a failure', async () => {
        requestCookies.set('rr_link_intent', 'google')
        exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'nope' } })

        const response = await callback('?code=abc')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/?account=sign-in&link_error=failed&link_provider=google')
    })

    it('forgets the signup intent of an account that was signed up before this sign-in', async () => {
        selectMaybeSingle.mockResolvedValue({ data: { signed_up_at: '2026-10-15T19:31:32Z' }, error: null })

        const response = await callback('?code=abc')

        expect(selectMaybeSingle).toHaveBeenCalledWith(expect.anything(), 'users', ['signed_up_at'], { id: 'user-1' })
        const cleared = response.headers.getSetCookie().find(cookie => cookie.startsWith('rr_signup_intent='))
        expect(cleared).toMatch(/^rr_signup_intent=;/)
        expect(cleared).toContain('Max-Age=0')
        expect(cleared).toContain('Domain=.rerun.build')
    })

    it('forgets the signup intent of an account signed up a few minutes before this sign-in', async () => {
        selectMaybeSingle.mockResolvedValue({ data: { signed_up_at: '2026-10-16T10:20:00.000Z' }, error: null })

        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_signup_intent')?.value).toBe('')
    })

    it('keeps the signup intent of a visitor whose Google identity was just linked, stamped by the middleware ahead of the handler', async () => {
        selectMaybeSingle.mockResolvedValue({ data: { signed_up_at: '2026-10-16T10:29:59.700Z' }, error: null })

        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_signup_intent')).toBeUndefined()
    })

    it('keeps the signup intent when the stamp is a minute old', async () => {
        selectMaybeSingle.mockResolvedValue({ data: { signed_up_at: '2026-10-16T10:29:00.000Z' }, error: null })

        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_signup_intent')).toBeUndefined()
    })

    it('keeps the signup intent of a Google account that has no row yet', async () => {
        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_signup_intent')).toBeUndefined()
    })

    it('leaves the signup intent alone when connecting Google from the settings', async () => {
        requestCookies.set('rr_link_intent', 'google')
        selectMaybeSingle.mockResolvedValue({ data: { signed_up_at: '2026-10-15T19:31:32Z' }, error: null })

        const response = await callback('?code=abc')

        expect(response.cookies.get('rr_signup_intent')).toBeUndefined()
    })
})
