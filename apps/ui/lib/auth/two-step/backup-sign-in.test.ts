import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateBackupCodes } from './backup-codes'
import type { TwoStepRecord } from './record'

const state = vi.hoisted(() => ({
    record: {} as TwoStepRecord,
    triesLeft: true,
    opens: true,
    elevate: vi.fn(async () => ({ accessToken: 'raised', refreshToken: 'raised-refresh' })),
}))

vi.mock('@/lib/rate-limit/attempts', () => ({ claimAttempt: async () => state.triesLeft }))
vi.mock('./recovery', () => ({ elevateSession: state.elevate }))
vi.mock('./seal', () => ({ opensSecret: () => state.opens }))
vi.mock('./store', () => ({
    readTwoStep: async () => structuredClone(state.record),
    writeTwoStep: async (_userId: string, record: TwoStepRecord | null) => {
        state.record = record ?? {}
    },
}))

const { signInWithBackupCode } = await import('./backup-sign-in')

const client = {} as SupabaseClient<Database>
let codes: string[]
const spentCount = () => (state.record.codes ?? []).filter(code => code.usedAt !== null).length

beforeEach(() => {
    const generated = generateBackupCodes()
    codes = generated.codes
    state.record = { recovery: { factorId: 'recovery', sealedSecret: 'sealed' }, salt: generated.salt, codes: generated.stored }
    state.triesLeft = true
    state.opens = true
    state.elevate.mockClear()
})

describe('signInWithBackupCode', () => {
    it('spends the code once, then raises the session', async () => {
        expect(await signInWithBackupCode(client, 'user-1', codes[0])).toEqual({ ok: true, accessToken: 'raised', refreshToken: 'raised-refresh' })
        expect(spentCount()).toBe(1)
        expect(await signInWithBackupCode(client, 'user-1', codes[0])).toEqual({ ok: false, reason: 'wrong_code' })
        expect(state.elevate).toHaveBeenCalledTimes(1)
    })

    it('refuses a code that is not one of the account', async () => {
        expect(await signInWithBackupCode(client, 'user-1', 'AAAA-AAAA')).toEqual({ ok: false, reason: 'wrong_code' })
        expect(spentCount()).toBe(0)
    })

    it('keeps a good code when the recovery secret no longer opens: the session could not be raised', async () => {
        state.opens = false
        await expect(signInWithBackupCode(client, 'user-1', codes[0])).rejects.toMatchObject({ code: 'generic' })
        expect(spentCount()).toBe(0)
        expect(state.elevate).not.toHaveBeenCalled()
    })

    it('stops after too many tries, before reading anything', async () => {
        state.triesLeft = false
        expect(await signInWithBackupCode(client, 'user-1', codes[0])).toEqual({ ok: false, reason: 'too_many' })
        expect(spentCount()).toBe(0)
    })
})
