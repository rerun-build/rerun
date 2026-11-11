import { Platform } from 'react-native'

import { signInWithApple } from '@/auth/apple'
import { SignInError } from '@/auth/sign-in'

const mockOpenAuthSession = jest.fn()
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args) }))
const mockSignInWithOAuth = jest.fn()
const mockExchange = jest.fn()
jest.mock('@/auth/supabase', () => ({ supabase: { auth: { signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args), exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args) } } }))
jest.mock('@/api/client', () => ({ api: jest.fn(), ApiError: class extends Error {} }))

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('signInWithApple on Android', () => {
    beforeEach(() => {
        mockOpenAuthSession.mockReset()
        mockSignInWithOAuth.mockReset().mockResolvedValue({ data: { url: 'https://supabase.example/authorize?provider=apple' }, error: null })
        mockExchange.mockReset().mockResolvedValue({ error: null })
    })

    it('runs Apple on the web and opens the session with the PKCE code that comes back', async () => {
        mockOpenAuthSession.mockResolvedValue({ type: 'success', url: 'rerun://auth/callback?code=the-code' })
        await expect(signInWithApple()).resolves.toBe(true)
        expect(mockSignInWithOAuth).toHaveBeenCalledWith({ provider: 'apple', options: { redirectTo: 'rerun://auth/callback', skipBrowserRedirect: true } })
        expect(mockOpenAuthSession).toHaveBeenCalledWith('https://supabase.example/authorize?provider=apple', 'rerun://auth/callback')
        expect(mockExchange).toHaveBeenCalledWith('the-code')
    })

    it('does nothing when the person closes the tab', async () => {
        mockOpenAuthSession.mockResolvedValue({ type: 'cancel' })
        await expect(signInWithApple()).resolves.toBe(false)
        expect(mockExchange).not.toHaveBeenCalled()
    })

    it('fails with one message when Apple sends no code back', async () => {
        mockOpenAuthSession.mockResolvedValue({ type: 'success', url: 'rerun://auth/callback?error=access_denied' })
        await expect(signInWithApple()).rejects.toBeInstanceOf(SignInError)
    })

    it('fails with one message when Supabase refuses the code', async () => {
        mockOpenAuthSession.mockResolvedValue({ type: 'success', url: 'rerun://auth/callback?code=stale' })
        mockExchange.mockResolvedValue({ error: new Error('invalid grant') })
        await expect(signInWithApple()).rejects.toBeInstanceOf(SignInError)
    })
})
