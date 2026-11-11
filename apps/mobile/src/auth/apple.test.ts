import { Platform } from 'react-native'

import { signInWithApple } from '@/auth/apple'
import { SignInError } from '@/auth/sign-in'

const mockSignInAsync = jest.fn()
jest.mock('expo-apple-authentication', () => ({
    signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}))
const mockSignInWithIdToken = jest.fn()
const mockUpdateUser = jest.fn()
jest.mock('@/auth/supabase', () => ({ supabase: { auth: { signInWithIdToken: (...args: unknown[]) => mockSignInWithIdToken(...args), updateUser: (...args: unknown[]) => mockUpdateUser(...args) } } }))
jest.mock('@/api/client', () => ({ api: jest.fn(), ApiError: class extends Error {} }))

const describeOnIos = Platform.OS === 'ios' ? describe : describe.skip

describeOnIos('signInWithApple on iOS', () => {
    beforeEach(() => {
        mockSignInAsync.mockReset()
        mockSignInWithIdToken.mockReset().mockResolvedValue({ error: null })
        mockUpdateUser.mockReset().mockResolvedValue({ error: null })
    })

    it('opens the Supabase session with the identity token Apple handed back', async () => {
        mockSignInAsync.mockResolvedValue({ identityToken: 'apple-jwt', fullName: null })
        await expect(signInWithApple()).resolves.toBe(true)
        expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-jwt' })
        expect(mockUpdateUser).not.toHaveBeenCalled()
    })

    it('keeps the name Apple gives on the first sign-in where the web reads it', async () => {
        mockSignInAsync.mockResolvedValue({ identityToken: 'apple-jwt', fullName: { givenName: 'Ada', familyName: 'Lovelace' } })
        await signInWithApple()
        expect(mockUpdateUser).toHaveBeenCalledWith({ data: { full_name: 'Ada Lovelace' } })
    })

    it('does nothing when the Apple sheet is closed', async () => {
        mockSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' })
        await expect(signInWithApple()).resolves.toBe(false)
        expect(mockSignInWithIdToken).not.toHaveBeenCalled()
    })

    it('shows one message whether Apple or Supabase refused', async () => {
        mockSignInAsync.mockResolvedValue({ identityToken: 'apple-jwt', fullName: null })
        mockSignInWithIdToken.mockResolvedValue({ error: { message: 'Unacceptable audience' } })
        await expect(signInWithApple()).rejects.toBeInstanceOf(SignInError)
    })
})
