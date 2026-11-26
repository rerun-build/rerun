import { mobileApi } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, expectContract } from '@/test/mobile-contract'

// The app's second step by a backup code. The auth server and the spending of the code are replaced:
// what is checked is what the app reads back.
const state = vi.hoisted(() => ({
    setSession: vi.fn(),
    signInWithBackupCode: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
    createClient: async () => ({}),
    createSessionlessClient: () => ({ auth: { setSession: state.setSession } }),
    getRequestAccessToken: async () => 'aal1-token',
}))
vi.mock('@/lib/auth/two-step/backup-sign-in', () => ({ signInWithBackupCode: state.signInWithBackupCode }))

const TWO_STEP_USER = { id: 'user-ada', is_anonymous: false, app_metadata: { two_step: true } }
const BODY = { code: 'K7QD-2MHL', refreshToken: 'r3fr35h' }

describe('POST /api/v1/auth/two-step/backup-code', () => {
    beforeEach(() => {
        state.setSession.mockReset().mockResolvedValue({ data: { user: TWO_STEP_USER, session: {} }, error: null })
        state.signInWithBackupCode.mockReset()
    })

    it('hands back the session raised by a good code', async () => {
        state.signInWithBackupCode.mockResolvedValue({ ok: true, accessToken: 'aal2-token', refreshToken: 'n3w-r3fr35h' })
        const { POST } = await import('@/app/api/v1/auth/two-step/backup-code/route')
        const res = await callRoute(POST, mobileApi.spendBackupCode, { body: BODY })
        expect(await expectContract(mobileApi.spendBackupCode, res)).toEqual({ session: { accessToken: 'aal2-token', refreshToken: 'n3w-r3fr35h' } })
        expect(state.setSession).toHaveBeenCalledWith({ access_token: 'aal1-token', refresh_token: 'r3fr35h' })
        expect(state.signInWithBackupCode).toHaveBeenCalledWith(expect.anything(), 'user-ada', 'K7QD-2MHL')
    })

    it('refuses a wrong code with 400, and too many tries with 429', async () => {
        const { POST } = await import('@/app/api/v1/auth/two-step/backup-code/route')
        state.signInWithBackupCode.mockResolvedValue({ ok: false, reason: 'wrong_code' })
        expect(await expectContract(mobileApi.spendBackupCode, await callRoute(POST, mobileApi.spendBackupCode, { body: BODY }), 400)).toMatchObject({ code: 'backupCodeWrong' })
        state.signInWithBackupCode.mockResolvedValue({ ok: false, reason: 'too_many' })
        expect(await expectContract(mobileApi.spendBackupCode, await callRoute(POST, mobileApi.spendBackupCode, { body: BODY }), 429)).toMatchObject({ code: 'backupCodeTooManyTries' })
    })

    it('refuses a session that will not open with 401', async () => {
        state.setSession.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Invalid Refresh Token' } })
        const { POST } = await import('@/app/api/v1/auth/two-step/backup-code/route')
        expect(await expectContract(mobileApi.spendBackupCode, await callRoute(POST, mobileApi.spendBackupCode, { body: BODY }), 401)).toMatchObject({ code: 'notAuthenticated' })
        expect(state.signInWithBackupCode).not.toHaveBeenCalled()
    })
})
