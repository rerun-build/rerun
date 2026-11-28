import { TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TwoStepRecord } from '@/lib/auth/two-step/record'

type FakeFactor = { id: string; friendly_name: string; factor_type: 'totp'; status: 'verified'; created_at: string }

// The auth server as Supabase runs it: a session remembers the factor that raised it to aal2, removing that
// factor drops the session back to aal1, and a verified factor is removed by its owner from an aal2 session
// only. The token the hub reads keeps its level until it is refreshed.
const auth = vi.hoisted(() => ({
    factors: [] as FakeFactor[],
    session: { aal: 'aal2', raisedBy: null as string | null },
    tokenAal: 'aal2',
    record: {} as TwoStepRecord,
    writes: [] as (TwoStepRecord | null)[],
    flags: [] as boolean[],
    adminDeleteError: null as string | null,
    enrollRecoveryFactor: vi.fn(),
}))

function removeFactor(factorId: string) {
    auth.factors = auth.factors.filter(factor => factor.id !== factorId)
    if (auth.session.raisedBy === factorId) auth.session = { aal: 'aal1', raisedBy: null }
}

const USER_ID = 'user-oren'
const account = () => ({ id: USER_ID, is_anonymous: false, app_metadata: { two_step: true }, factors: auth.factors.map(factor => ({ ...factor })) })

const userClient = {
    auth: {
        getUser: async () => ({ data: { user: account() }, error: null }),
        getClaims: async () => ({ data: { claims: { session_id: 'session-1' } }, error: null }),
        refreshSession: async () => {
            auth.tokenAal = auth.session.aal
            return { data: {}, error: null }
        },
        signOut: async () => ({ error: null }),
        mfa: {
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: auth.tokenAal }, error: null }),
            listFactors: async () => ({ data: { all: auth.factors }, error: null }),
            unenroll: async ({ factorId }: { factorId: string }) => {
                if (auth.session.aal !== 'aal2') return { data: null, error: { status: 422, message: 'AAL2 required to unenroll verified factor' } }
                removeFactor(factorId)
                return { data: { id: factorId }, error: null }
            },
        },
    },
}

const serviceClient = {
    auth: {
        admin: {
            mfa: {
                deleteFactor: async ({ id }: { id: string; userId: string }) => {
                    if (auth.adminDeleteError) return { data: null, error: { message: auth.adminDeleteError } }
                    removeFactor(id)
                    return { data: { id }, error: null }
                },
            },
        },
    },
}

vi.mock('@/supabase/server', () => ({ createClient: async () => userClient }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => serviceClient }))
vi.mock('@/supabase/session/getServerSession', () => ({ getAuthUser: async () => account(), getSigningInAccount: async () => null }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: async () => ({ data: [], error: null }) }))
vi.mock('@/lib/brand/server', () => ({ getBrand: async () => ({}) }))
vi.mock('@/lib/auth/two-step/passkeys', () => ({}))
vi.mock('@/lib/auth/two-step/backup-sign-in', () => ({}))
vi.mock('@/lib/auth/two-step/seal', () => ({ opensSecret: () => true }))
vi.mock('@/lib/auth/two-step/recovery', () => ({ enrollRecoveryFactor: auth.enrollRecoveryFactor }))
vi.mock('@/lib/auth/two-step/store', () => ({
    readTwoStep: async () => auth.record,
    writeTwoStep: async (_userId: string, record: TwoStepRecord | null) => {
        auth.writes.push(record)
        auth.record = record ?? {}
    },
    writeTwoStepFlag: async (_userId: string, on: boolean) => {
        auth.flags.push(on)
    },
}))

const { getSecurityAction, removeTwoStepMethodAction } = await import('./two-step.actions')

const APP: FakeFactor = { id: 'factor-app', friendly_name: 'Authenticator app', factor_type: 'totp', status: 'verified', created_at: '2026-11-27T16:04:34Z' }
const RECOVERY: FakeFactor = { id: 'factor-recovery', friendly_name: TWO_STEP_RECOVERY_FACTOR_NAME, factor_type: 'totp', status: 'verified', created_at: '2026-11-27T16:06:06Z' }
const RECORD: TwoStepRecord = { recovery: { factorId: RECOVERY.id, sealedSecret: 'sealed' }, salt: 'salt', codes: [{ hash: 'hash-1', usedAt: null }] }

beforeEach(() => {
    auth.factors = [APP, RECOVERY]
    auth.session = { aal: 'aal2', raisedBy: RECOVERY.id }
    auth.tokenAal = 'aal2'
    auth.record = RECORD
    auth.writes = []
    auth.flags = []
    auth.adminDeleteError = null
    auth.enrollRecoveryFactor.mockReset().mockResolvedValue({ factorId: 'factor-recovery-2', sealedSecret: 'sealed-2' })
})

describe('removeTwoStepMethodAction', () => {
    it('removes the last method from the session two-step was set up on, which the recovery factor raised', async () => {
        await expect(removeTwoStepMethodAction({ methodId: APP.id })).resolves.toEqual({ ok: true })
        expect(auth.factors).toEqual([])
        expect(auth.writes).toEqual([null])
        expect(auth.flags).toEqual([false])
    })

    it('removes the last method from a session the authenticator app raised', async () => {
        auth.session = { aal: 'aal2', raisedBy: APP.id }
        await expect(removeTwoStepMethodAction({ methodId: APP.id })).resolves.toEqual({ ok: true })
        expect(auth.factors).toEqual([])
    })

    it('asks a session that has not been through its second step to confirm first', async () => {
        auth.session = { aal: 'aal1', raisedBy: null }
        auth.tokenAal = 'aal1'
        await expect(removeTwoStepMethodAction({ methodId: APP.id })).resolves.toMatchObject({ ok: false, code: 'twoStepConfirmFirst' })
        expect(auth.factors).toEqual([APP, RECOVERY])
    })

    it('answers its own error rather than the auth server raw message', async () => {
        auth.adminDeleteError = 'AAL2 required to unenroll verified factor'
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        await expect(removeTwoStepMethodAction({ methodId: APP.id })).resolves.toEqual({ ok: false, error: 'Could not remove this method.', code: 'twoStepRemoveFailed' })
    })
})

describe('getSecurityAction', () => {
    it('sets the recovery factor up again once it is gone from the account', async () => {
        auth.factors = [APP]
        auth.session = { aal: 'aal2', raisedBy: APP.id }
        await expect(getSecurityAction()).resolves.toMatchObject({ ok: true, codes: null })
        expect(auth.enrollRecoveryFactor).toHaveBeenCalledOnce()
        expect(auth.writes).toEqual([{ ...RECORD, recovery: { factorId: 'factor-recovery-2', sealedSecret: 'sealed-2' } }])
    })

    it('still loads the tab when the auth server refuses to set the recovery factor up again', async () => {
        auth.factors = [APP]
        auth.session = { aal: 'aal2', raisedBy: APP.id }
        auth.enrollRecoveryFactor.mockRejectedValue(new Error('AAL2 required to enroll a new factor'))
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        await expect(getSecurityAction()).resolves.toMatchObject({ ok: true, codes: null, security: { app: { id: APP.id } } })
        expect(auth.writes).toEqual([])
    })

    it('leaves a missing recovery factor alone on a session that has not been through its second step', async () => {
        auth.factors = [APP]
        auth.session = { aal: 'aal1', raisedBy: null }
        auth.tokenAal = 'aal1'
        await expect(getSecurityAction()).resolves.toMatchObject({ ok: true })
        expect(auth.enrollRecoveryFactor).not.toHaveBeenCalled()
        expect(auth.writes).toEqual([])
    })
})
