import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { asksSecondStep, awaitsSecondStep, readAccount, readSettledUser, tokenHasTwoStep } from './gate'

const verified = (id: string, friendly_name?: string) => ({ id, friendly_name, status: 'verified', factor_type: 'totp' })
const token = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`

function clientOf(appMetadata: Record<string, unknown>, level: 'aal1' | 'aal2', factors: object[] = []) {
    return {
        auth: {
            getUser: vi.fn(async () => ({ data: { user: { id: 'u1', app_metadata: appMetadata, factors } } })),
            mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: level } })) },
        },
    } as unknown as SupabaseClient<Database>
}

describe('awaitsSecondStep', () => {
    it('holds an account with two-step at aal1 only', () => {
        expect(awaitsSecondStep({ two_step: true }, 'aal1')).toBe(true)
        expect(awaitsSecondStep({ two_step: true }, undefined)).toBe(true)
        expect(awaitsSecondStep({ two_step: true }, 'aal2')).toBe(false)
        expect(awaitsSecondStep({}, 'aal1')).toBe(false)
        expect(awaitsSecondStep({ two_step: null }, 'aal1')).toBe(false)
        expect(awaitsSecondStep(undefined, 'aal1')).toBe(false)
    })
})

describe('readSettledUser', () => {
    it('lets through an account without two-step, without reading the level', async () => {
        const client = clientOf({}, 'aal1')
        expect(await readSettledUser(client)).toMatchObject({ id: 'u1' })
        expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    })

    it('holds an account with two-step until its session reaches aal2', async () => {
        expect(await readSettledUser(clientOf({ two_step: true }, 'aal1'))).toBeNull()
        expect(await readAccount(clientOf({ two_step: true }, 'aal1'))).toMatchObject({ pending: true })
        expect(await readSettledUser(clientOf({ two_step: true }, 'aal2'))).toMatchObject({ id: 'u1' })
    })

    it('holds an account whose setup was cut short before the flag was written', async () => {
        expect(await readAccount(clientOf({}, 'aal1', [verified('app')]))).toMatchObject({ pending: true })
        expect(await readAccount(clientOf({}, 'aal1', [verified('recovery', 'rerun-recovery')]))).toMatchObject({ pending: false })
    })

    it('reads the level of a token handed over from the token, without asking the auth server again', async () => {
        const client = clientOf({ two_step: true }, 'aal1')
        expect(await readAccount(client, token({ aal: 'aal2' }))).toMatchObject({ pending: false })
        expect(await readAccount(client, token({ aal: 'aal1' }))).toMatchObject({ pending: true })
        expect(client.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    })
})

describe('asksSecondStep', () => {
    it('asks for it on the flag, or on a method of the person’s own, never on the recovery factor alone', () => {
        expect(asksSecondStep({ app_metadata: { two_step: true }, factors: [] })).toBe(true)
        expect(asksSecondStep({ app_metadata: {}, factors: [verified('app')] as never })).toBe(true)
        expect(asksSecondStep({ app_metadata: {}, factors: [verified('recovery', 'rerun-recovery')] as never })).toBe(false)
        expect(asksSecondStep({ app_metadata: {}, factors: [{ ...verified('app'), status: 'unverified' }] as never })).toBe(false)
    })
})

describe('tokenHasTwoStep', () => {
    it('reads the flag a token was issued with', () => {
        expect(tokenHasTwoStep(token({ app_metadata: { two_step: true } }))).toBe(true)
        expect(tokenHasTwoStep(token({ app_metadata: {} }))).toBe(false)
        expect(tokenHasTwoStep('not a token')).toBe(false)
        expect(tokenHasTwoStep(undefined)).toBe(false)
    })
})
