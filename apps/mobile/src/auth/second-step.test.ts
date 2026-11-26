import type { Factor } from '@supabase/supabase-js'

import { ApiError } from '@/api/client'
import { methodsOf, owesSecondStep, spendBackupCode } from '@/auth/second-step'

const mockApi = jest.fn()
jest.mock('@/api/client', () => {
    const actual = jest.requireActual('@/api/client')
    return { ...actual, hub: actual.createHubClient((...args: unknown[]) => mockApi(...args)) }
})
const mockSetSession = jest.fn()
const mockGetSession = jest.fn()
jest.mock('@/auth/supabase', () => ({ supabase: { auth: { setSession: (...args: unknown[]) => mockSetSession(...args), getSession: () => mockGetSession() } } }))
jest.mock('react-native-passkeys', () => ({ isSupported: () => true, get: jest.fn() }))

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

    it("lists the person's methods without the hub's own, the last used passkey first", () => {
        const methods = methodsOf([
            factor('recovery', 'totp', { friendly_name: 'rerun-recovery' }),
            factor('app', 'totp', { friendly_name: 'Authenticator app' }),
            factor('old-key', 'webauthn', { last_challenged_at: '2026-11-02T10:00:00Z' }),
            factor('mac', 'webauthn', { last_challenged_at: '2026-11-20T10:00:00Z' }),
            factor('half-set-up', 'webauthn', { status: 'unverified' }),
        ])
        expect(methods).toEqual({ appFactorId: 'app', passkeyFactorIds: ['mac', 'old-key'] })
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
