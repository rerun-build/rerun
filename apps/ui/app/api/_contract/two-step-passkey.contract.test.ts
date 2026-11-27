import { mobileApi } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, expectContract } from '@/test/mobile-contract'

// The app's second step by a passkey. The auth server and the WebAuthn checks are replaced: what is
// checked is what the app reads back.
const state = vi.hoisted(() => ({
    getUser: vi.fn(),
    setSession: vi.fn(),
    passkeySignInOptions: vi.fn(),
    signInWithPasskey: vi.fn(),
    whiteLabel: false,
}))

vi.mock('@/supabase/server', () => ({
    createClient: async () => ({}),
    createSessionlessClient: () => ({ auth: { getUser: state.getUser, setSession: state.setSession } }),
    getRequestAccessToken: async () => 'aal1-token',
}))
vi.mock('@/lib/auth/two-step/passkeys', () => ({ passkeySignInOptions: state.passkeySignInOptions, signInWithPasskey: state.signInWithPasskey }))
vi.mock('@/lib/brand/server', () => ({ getBrand: async () => (state.whiteLabel ? { kind: 'organization', name: 'Acme' } : { kind: 'rerun', name: 'Rerun' }) }))
vi.mock('@rerun/contracts', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/contracts')>()), isWhiteLabel: () => state.whiteLabel }))

const TWO_STEP_USER = { id: 'user-ada', is_anonymous: false, app_metadata: { two_step: true } }
const OPTIONS = { challenge: 'c4allenge', rpId: 'app.rerun.build', userVerification: 'preferred' as const, allowCredentials: [{ id: 'cred-1', type: 'public-key' as const, transports: ['internal'] }] }
const ASSERTION = { id: 'cred-1', rawId: 'cred-1', type: 'public-key' as const, response: { clientDataJSON: 'cdj', authenticatorData: 'ad', signature: 'sig', userHandle: null }, authenticatorAttachment: 'platform' as const }
const BODY = { assertion: ASSERTION, refreshToken: 'r3fr35h' }

beforeEach(() => {
    state.getUser.mockReset().mockResolvedValue({ data: { user: TWO_STEP_USER } })
    state.setSession.mockReset().mockResolvedValue({ data: { user: TWO_STEP_USER, session: {} }, error: null })
    state.passkeySignInOptions.mockReset().mockResolvedValue(OPTIONS)
    state.signInWithPasskey.mockReset()
    state.whiteLabel = false
})

describe('POST /api/v1/auth/two-step/passkey/options', () => {
    it('hands the options of a sign-in with every passkey of the account', async () => {
        const { POST } = await import('@/app/api/v1/auth/two-step/passkey/options/route')
        expect(await expectContract(mobileApi.passkeyOptions, await callRoute(POST, mobileApi.passkeyOptions, {}))).toEqual({ options: OPTIONS })
        expect(state.getUser).toHaveBeenCalledWith('aal1-token')
        expect(state.passkeySignInOptions).toHaveBeenCalledWith('user-ada')
    })

    it('offers none on an account without passkeys, nor on an organization address', async () => {
        const { POST } = await import('@/app/api/v1/auth/two-step/passkey/options/route')
        state.passkeySignInOptions.mockResolvedValue(null)
        expect(await expectContract(mobileApi.passkeyOptions, await callRoute(POST, mobileApi.passkeyOptions, {}))).toEqual({ options: null })
        state.passkeySignInOptions.mockResolvedValue(OPTIONS)
        state.whiteLabel = true
        expect(await expectContract(mobileApi.passkeyOptions, await callRoute(POST, mobileApi.passkeyOptions, {}))).toEqual({ options: null })
    })

    it('refuses a token the auth server does not know with 401', async () => {
        state.getUser.mockResolvedValue({ data: { user: null } })
        const { POST } = await import('@/app/api/v1/auth/two-step/passkey/options/route')
        expect(await expectContract(mobileApi.passkeyOptions, await callRoute(POST, mobileApi.passkeyOptions, {}), 401)).toMatchObject({ code: 'notAuthenticated' })
    })
})

describe('POST /api/v1/auth/two-step/passkey', () => {
    it('hands back the session raised by a passkey that holds', async () => {
        state.signInWithPasskey.mockResolvedValue({ ok: true, accessToken: 'aal2-token', refreshToken: 'n3w-r3fr35h' })
        const { POST } = await import('@/app/api/v1/auth/two-step/passkey/route')
        const res = await callRoute(POST, mobileApi.signInWithPasskey, { body: BODY })
        expect(await expectContract(mobileApi.signInWithPasskey, res)).toEqual({ session: { accessToken: 'aal2-token', refreshToken: 'n3w-r3fr35h' } })
        expect(state.setSession).toHaveBeenCalledWith({ access_token: 'aal1-token', refresh_token: 'r3fr35h' })
        expect(state.signInWithPasskey).toHaveBeenCalledWith(expect.anything(), 'user-ada', expect.objectContaining({ id: 'cred-1', clientExtensionResults: {}, response: expect.objectContaining({ userHandle: undefined }) }))
    })

    it('refuses a passkey that does not hold with 400, and too many tries with 429', async () => {
        const { POST } = await import('@/app/api/v1/auth/two-step/passkey/route')
        state.signInWithPasskey.mockResolvedValue({ ok: false, reason: 'refused' })
        expect(await expectContract(mobileApi.signInWithPasskey, await callRoute(POST, mobileApi.signInWithPasskey, { body: BODY }), 400)).toMatchObject({ code: 'passkeyRefused' })
        state.signInWithPasskey.mockResolvedValue({ ok: false, reason: 'too_many' })
        expect(await expectContract(mobileApi.signInWithPasskey, await callRoute(POST, mobileApi.signInWithPasskey, { body: BODY }), 429)).toMatchObject({ code: 'backupCodeTooManyTries' })
    })

    it('refuses a session that will not open with 401', async () => {
        state.setSession.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Invalid Refresh Token' } })
        const { POST } = await import('@/app/api/v1/auth/two-step/passkey/route')
        expect(await expectContract(mobileApi.signInWithPasskey, await callRoute(POST, mobileApi.signInWithPasskey, { body: BODY }), 401)).toMatchObject({ code: 'notAuthenticated' })
        expect(state.signInWithPasskey).not.toHaveBeenCalled()
    })
})
