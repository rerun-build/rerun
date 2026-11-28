import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    cookies: {} as Record<string, string>,
    acceptLanguage: null as string | null,
    user: null as { id: string; locale: string | null } | null,
}))

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) => (name in mocks.cookies ? { name, value: mocks.cookies[name] } : undefined),
        getAll: () => Object.entries(mocks.cookies).map(([name, value]) => ({ name, value })),
    }),
    headers: async () => new Headers(mocks.acceptLanguage ? { 'accept-language': mocks.acceptLanguage } : {}),
}))
vi.mock('@/supabase/session/getServerSession', () => ({
    getSessionWorkspace: async () => ({ user: mocks.user }),
}))

const { requestLocale } = await import('./request-locale')

const signedIn = { 'sb-local-auth-token': 'session' }

describe('requestLocale', () => {
    beforeEach(() => {
        mocks.cookies = {}
        mocks.acceptLanguage = null
        mocks.user = { id: 'u1', locale: null }
    })

    it('reads the account before a language cookie an older choice left on the device', async () => {
        mocks.cookies = { ...signedIn, NEXT_LOCALE: 'zh' }
        mocks.user = { id: 'u1', locale: 'zh-TW' }
        mocks.acceptLanguage = 'zh-TW,zh;q=0.9'
        expect(await requestLocale()).toBe('zh-TW')
    })

    it('keeps the language picked on the landing for an account on Automatic', async () => {
        mocks.cookies = { ...signedIn, NEXT_LOCALE: 'fr' }
        mocks.acceptLanguage = 'en-US'
        expect(await requestLocale()).toBe('fr')
    })

    it('follows the browser for an account on Automatic without a cookie', async () => {
        mocks.cookies = signedIn
        mocks.acceptLanguage = 'zh-HK'
        expect(await requestLocale()).toBe('zh-TW')
    })

    it('reads the cookie when the session cookie names no account', async () => {
        mocks.cookies = { ...signedIn, NEXT_LOCALE: 'fr' }
        mocks.user = null
        mocks.acceptLanguage = 'en-US'
        expect(await requestLocale()).toBe('fr')
    })

    it('keeps the language a visitor picked on the landing', async () => {
        mocks.cookies = { NEXT_LOCALE: 'fr' }
        mocks.acceptLanguage = 'en-US'
        expect(await requestLocale()).toBe('fr')
    })

    it('follows the browser of a visitor without a choice', async () => {
        mocks.acceptLanguage = 'zh-HK'
        expect(await requestLocale()).toBe('zh-TW')
    })
})
