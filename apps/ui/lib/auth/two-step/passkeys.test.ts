import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/app/api/database.types'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TwoStepRecord } from './record'

const state = vi.hoisted(() => ({
    record: {} as TwoStepRecord,
    triesLeft: true,
    verified: true,
    elevate: vi.fn(async () => ({ accessToken: 'raised', refreshToken: 'raised-refresh' })),
    verifyAuthentication: vi.fn(),
}))

vi.mock('@/lib/app-origin', () => ({ getAppOrigin: async () => 'https://app.rerun.build' }))
vi.mock('@/lib/brand/server', () => ({ getBrand: async () => ({ name: 'Rerun' }) }))
vi.mock('./passkey-apps', () => ({ androidPasskeyApps: () => [{ packageName: 'build.rerun.app', fingerprint: 'AB:CD:EF' }] }))
vi.mock('./backup-sign-in', () => ({ claimSecondStepTry: async () => state.triesLeft }))
vi.mock('./recovery', () => ({ elevateSession: state.elevate }))
vi.mock('./store', () => ({
    readTwoStep: async () => structuredClone(state.record),
    writeTwoStep: async (_userId: string, record: TwoStepRecord | null) => {
        state.record = record ?? {}
    },
}))
vi.mock('@simplewebauthn/server', () => ({
    generateRegistrationOptions: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
    generateAuthenticationOptions: async () => ({ challenge: 'challenge-1', rpId: 'app.rerun.build' }),
    verifyAuthenticationResponse: state.verifyAuthentication,
}))

const { androidOrigin, liveChallenge, passkeySignInOptions, relyingParty, signInWithPasskey } = await import('./passkeys')

const client = {} as SupabaseClient<Database>
const passkey = { id: 'pk-1', credentialId: 'cred-1', publicKey: Buffer.from('key').toString('base64url'), counter: 3, name: 'Mac', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null }
const answer = { id: 'cred-1' } as AuthenticationResponseJSON

beforeEach(() => {
    state.record = { recovery: { factorId: 'recovery', sealedSecret: 'sealed' }, passkeys: [passkey] }
    state.triesLeft = true
    state.elevate.mockClear()
    state.verifyAuthentication.mockReset()
    state.verifyAuthentication.mockImplementation(async () => ({ verified: state.verified, authenticationInfo: { newCounter: 4 } }))
    state.verified = true
})

describe('relyingParty', () => {
    it('is the hub domain, its origin and the Android app signing key', async () => {
        expect(androidOrigin('AB:CD:EF')).toBe(`android:apk-key-hash:${Buffer.from([0xab, 0xcd, 0xef]).toString('base64url')}`)
        expect(await relyingParty()).toEqual({ rpID: 'app.rerun.build', origins: ['https://app.rerun.build', androidOrigin('AB:CD:EF')] })
    })
})

describe('liveChallenge', () => {
    const now = Date.parse('2026-11-27T12:00:00Z')
    it('answers only the ceremony it was asked for, before it expires', () => {
        const record: TwoStepRecord = { challenge: { value: 'c', purpose: 'sign-in', expiresAt: '2026-11-27T12:05:00Z' } }
        expect(liveChallenge(record, 'sign-in', now)).toBe('c')
        expect(liveChallenge(record, 'register', now)).toBeNull()
        expect(liveChallenge(record, 'sign-in', Date.parse('2026-11-27T12:05:00Z'))).toBeNull()
        expect(liveChallenge({}, 'sign-in', now)).toBeNull()
    })
})

describe('signInWithPasskey', () => {
    it('raises the session once the passkey answers its challenge, and keeps the new counter', async () => {
        await passkeySignInOptions('u1')
        expect(await signInWithPasskey(client, 'u1', answer)).toEqual({ ok: true, accessToken: 'raised', refreshToken: 'raised-refresh' })
        expect(state.verifyAuthentication).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: 'challenge-1', expectedRPID: 'app.rerun.build' }))
        expect(state.record.challenge).toBeUndefined()
        expect(state.record.passkeys?.[0]).toMatchObject({ counter: 4, lastUsedAt: expect.any(String) })
    })

    it('spends the challenge: the same answer sent again is refused', async () => {
        await passkeySignInOptions('u1')
        await signInWithPasskey(client, 'u1', answer)
        expect(await signInWithPasskey(client, 'u1', answer)).toEqual({ ok: false, reason: 'refused' })
        expect(state.elevate).toHaveBeenCalledTimes(1)
    })

    it('refuses a passkey of another account, or a signature that does not hold, and spends the challenge', async () => {
        await passkeySignInOptions('u1')
        expect(await signInWithPasskey(client, 'u1', { id: 'someone-else' } as AuthenticationResponseJSON)).toEqual({ ok: false, reason: 'refused' })
        expect(state.record.challenge).toBeUndefined()

        await passkeySignInOptions('u1')
        state.verified = false
        expect(await signInWithPasskey(client, 'u1', answer)).toEqual({ ok: false, reason: 'refused' })
        state.verifyAuthentication.mockRejectedValueOnce(new Error('Response counter value 2 was lower than expected 3'))
        await passkeySignInOptions('u1')
        expect(await signInWithPasskey(client, 'u1', answer)).toEqual({ ok: false, reason: 'refused' })
        expect(state.elevate).not.toHaveBeenCalled()
    })

    it('stops after too many tries, before reading anything', async () => {
        await passkeySignInOptions('u1')
        state.triesLeft = false
        expect(await signInWithPasskey(client, 'u1', answer)).toEqual({ ok: false, reason: 'too_many' })
        expect(state.verifyAuthentication).not.toHaveBeenCalled()
    })

    it('offers nothing to an account without passkeys', async () => {
        state.record = {}
        expect(await passkeySignInOptions('u1')).toBeNull()
    })
})
