import type { Factor } from '@supabase/supabase-js'

import { ApiError } from '@/api/client'
import { appFactorOf, owesSecondStep, spendBackupCode } from '@/auth/second-step'

const mockApi = jest.fn()
jest.mock('@/api/client', () => {
    const actual = jest.requireActual('@/api/client')
    return { ...actual, hub: actual.createHubClient((...args: unknown[]) => mockApi(...args)) }
})
const mockSetSession = jest.fn()
const mockGetSession = jest.fn()
jest.mock('@/auth/supabase', () => ({ supabase: { auth: { setSession: (...args: unknown[]) => mockSetSession(...args), getSession: () => mockGetSession() } } }))
const mockPasskeyGet = jest.fn()
jest.mock('react-native-passkeys', () => ({ isSupported: () => true, get: (...args: unknown[]) => mockPasskeyGet(...args) }))
jest.mock('@/config/environment', () => ({ environment: { apiUrl: 'https://app.rerun.build' } }))

const factor = (id: string, type: 'totp' | 'webauthn', extra: Partial<Factor> = {}): Factor => ({ id, factor_type: type, status: 'verified', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', ...extra }) as Factor

describe('second step', () => {
    it('is owed by a session at aal1 whose account asks for it', () => {
        const flagged = { app_metadata: { two_step: true }, factors: [factor('app', 'totp')] }
        expect(owesSecondStep('aal1', flagged)).toBe(true)
        expect(owesSecondStep('aal2', flagged)).toBe(false)
        expect(owesSecondStep('aal1', { app_metadata: {}, factors: [] })).toBe(false)
        expect(owesSecondStep(null, flagged)).toBe(false)
        expect(owesSecondStep('aal1', null)).toBe(false)
    })

    it('is owed for a method a cut-short setup left without the flag, never for the recovery factor alone', () => {
        expect(owesSecondStep('aal1', { app_metadata: {}, factors: [factor('app', 'totp')] })).toBe(true)
        expect(owesSecondStep('aal1', { app_metadata: {}, factors: [factor('recovery', 'totp', { friendly_name: 'rerun-recovery' })] })).toBe(false)
    })

    it("finds the person's authenticator app, never the hub's recovery factor", () => {
        expect(appFactorOf([factor('recovery', 'totp', { friendly_name: 'rerun-recovery' }), factor('app', 'totp', { friendly_name: 'Authenticator app' })])).toBe('app')
        expect(appFactorOf([factor('recovery', 'totp', { friendly_name: 'rerun-recovery' }), factor('half', 'totp', { status: 'unverified' })])).toBeNull()
    })

    describe('by passkey, checked by the hub', () => {
        const OPTIONS = { challenge: 'c4allenge', rpId: 'app.rerun.build', allowCredentials: [{ id: 'cred-1', type: 'public-key' }] }
        const ASSERTION = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { clientDataJSON: 'cdj', authenticatorData: 'ad', signature: 'sig' }, clientExtensionResults: {} }
        let verifyWithPasskey: typeof import('@/auth/second-step').verifyWithPasskey

        beforeEach(() => {
            process.env.EXPO_PUBLIC_PASSKEY_DOMAINS = 'app.rerun.build'
            jest.isolateModules(() => {
                // The domains are read when the module loads: it is loaded again under this one.
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                verifyWithPasskey = require('@/auth/second-step').verifyWithPasskey
            })
            mockApi.mockReset()
            mockPasskeyGet.mockReset()
            mockSetSession.mockClear()
            mockGetSession.mockResolvedValue({ data: { session: { access_token: 'aal1', refresh_token: 'r1' } } })
            mockSetSession.mockResolvedValue({ error: null })
        })

        it('hands the native sheet the hub options as they are, then keeps the session the hub raised', async () => {
            mockApi.mockResolvedValueOnce({ options: OPTIONS }).mockResolvedValueOnce({ session: { accessToken: 'aal2', refreshToken: 'r2' } })
            mockPasskeyGet.mockResolvedValue(ASSERTION)
            expect(await verifyWithPasskey()).toBe('ok')
            expect(mockPasskeyGet).toHaveBeenCalledWith(OPTIONS)
            expect(mockApi).toHaveBeenNthCalledWith(1, '/api/v1/auth/two-step/passkey/options', expect.objectContaining({ method: 'POST', accessToken: 'aal1' }))
            expect(mockApi).toHaveBeenNthCalledWith(2, '/api/v1/auth/two-step/passkey', expect.objectContaining({ method: 'POST', accessToken: 'aal1', body: { assertion: ASSERTION, refreshToken: 'r1' } }))
            expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'aal2', refresh_token: 'r2' })
        })

        it('is refused when the sheet is closed, the account has no passkey, or the hub says no', async () => {
            mockApi.mockResolvedValueOnce({ options: OPTIONS })
            mockPasskeyGet.mockRejectedValue(new Error('cancelled'))
            expect(await verifyWithPasskey()).toBe('refused')
            mockApi.mockResolvedValueOnce({ options: null })
            expect(await verifyWithPasskey()).toBe('refused')
            mockPasskeyGet.mockResolvedValue(ASSERTION)
            mockApi.mockResolvedValueOnce({ options: OPTIONS }).mockRejectedValueOnce(new ApiError(429, 'Too many tries.', { error: 'Too many tries.', code: 'backupCodeTooManyTries' }))
            expect(await verifyWithPasskey()).toBe('too_many')
            expect(mockSetSession).not.toHaveBeenCalled()
        })
    })

    it('hands the session to the hub with a backup code and keeps the raised one', async () => {
        mockGetSession.mockResolvedValue({ data: { session: { access_token: 'aal1', refresh_token: 'r1' } } })
        mockApi.mockResolvedValue({ session: { accessToken: 'aal2', refreshToken: 'r2' } })
        mockSetSession.mockResolvedValue({ error: null })
        expect(await spendBackupCode(' K7QD-2MHL ')).toBe('ok')
        expect(mockApi).toHaveBeenCalledWith('/api/v1/auth/two-step/backup-code', expect.objectContaining({ method: 'POST', accessToken: 'aal1', body: { code: 'K7QD-2MHL', refreshToken: 'r1' } }))
        expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'aal2', refresh_token: 'r2' })
    })

    it('tells a wrong code from too many tries', async () => {
        mockGetSession.mockResolvedValue({ data: { session: { access_token: 'aal1', refresh_token: 'r1' } } })
        mockApi.mockRejectedValueOnce(new ApiError(400, 'This code does not work.', { error: 'This code does not work.', code: 'backupCodeWrong' }))
        expect(await spendBackupCode('AAAA-BBBB')).toBe('wrong')
        mockApi.mockRejectedValueOnce(new ApiError(429, 'Too many tries.', { error: 'Too many tries.', code: 'backupCodeTooManyTries' }))
        expect(await spendBackupCode('AAAA-BBBB')).toBe('too_many')
    })
})
