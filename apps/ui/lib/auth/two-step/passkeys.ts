import 'server-only'

import type { Database } from '@/app/api/database.types'
import { getAppOrigin } from '@/lib/app-origin'
import { getBrand } from '@/lib/brand/server'
import { randomUuid } from '@/lib/random-uuid'
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { claimSecondStepTry } from './backup-sign-in'
import { androidPasskeyApps } from './passkey-apps'
import { PASSKEY_NAME_MAX, type StoredPasskey, type TwoStepRecord } from './record'
import { elevateSession } from './recovery'
import { readTwoStep, writeTwoStep } from './store'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

// Android signs an assertion with its app's signing key as the origin, the SHA-256 fingerprint of
// its certificate (`AB:CD:…`) in base64url.
export function androidOrigin(fingerprint: string): string {
    return `android:apk-key-hash:${Buffer.from(fingerprint.replace(/[^0-9a-f]/gi, ''), 'hex').toString('base64url')}`
}

// A passkey belongs to the hub's own domain: the address it is served on, the iPhone app that shares
// it through its associated domains and the Android apps of assetlinks.json.
export async function relyingParty(): Promise<{ rpID: string; origins: string[] }> {
    const origin = await getAppOrigin()
    return { rpID: new URL(origin).hostname, origins: [origin, ...androidPasskeyApps().map(app => androidOrigin(app.fingerprint))] }
}

function withChallenge(record: TwoStepRecord, value: string, purpose: 'register' | 'sign-in', now = Date.now()): TwoStepRecord {
    return { ...record, challenge: { value, purpose, expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString() } }
}

// The challenge this ceremony was asked with, still good: spent as soon as it is read.
export function liveChallenge(record: TwoStepRecord, purpose: 'register' | 'sign-in', now = Date.now()): string | null {
    const challenge = record.challenge
    if (!challenge || challenge.purpose !== purpose || Date.parse(challenge.expiresAt) <= now) return null
    return challenge.value
}

function withoutChallenge(record: TwoStepRecord): TwoStepRecord {
    const rest = { ...record }
    delete rest.challenge
    return rest
}

export function cleanPasskeyName(name: string | undefined): string | null {
    const clean = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, PASSKEY_NAME_MAX)
    return clean || null
}

// Any authenticator is welcome: Touch ID, Face ID, Windows Hello, a phone or a security key.
export async function passkeyRegistrationOptions(account: User, record: TwoStepRecord): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { rpID } = await relyingParty()
    const options = await generateRegistrationOptions({
        rpName: (await getBrand()).name,
        rpID,
        userName: account.email ?? account.phone ?? account.id,
        userID: new TextEncoder().encode(account.id),
        attestationType: 'none',
        excludeCredentials: (record.passkeys ?? []).map(passkey => ({ id: passkey.credentialId, transports: passkey.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    })
    await writeTwoStep(account.id, withChallenge(record, options.challenge, 'register'))
    return options
}

// The new passkey, once its answer holds, with the challenge spent. Not stored yet: the caller does,
// along with whatever turning two-step on writes.
export async function verifyPasskeyRegistration(userId: string, response: RegistrationResponseJSON, name: string): Promise<{ record: TwoStepRecord; passkey: StoredPasskey } | null> {
    const stored = await readTwoStep(userId)
    const expectedChallenge = liveChallenge(stored, 'register')
    const record = withoutChallenge(stored)
    if (stored.challenge) await writeTwoStep(userId, record)
    if (!expectedChallenge) return null

    const { rpID, origins } = await relyingParty()
    const verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: false }).catch(() => null)
    if (!verification?.verified) return null
    const { credential } = verification.registrationInfo
    if ((record.passkeys ?? []).some(passkey => passkey.credentialId === credential.id)) return null
    const passkey: StoredPasskey = {
        id: randomUuid(),
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports,
        name,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
    }
    return { record, passkey }
}

// Every passkey of the account is offered: the browser or the phone shows the ones it holds.
export async function passkeySignInOptions(userId: string): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
    const record = await readTwoStep(userId)
    if (!record.passkeys?.length) return null
    const { rpID } = await relyingParty()
    const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'preferred',
        allowCredentials: record.passkeys.map(passkey => ({ id: passkey.credentialId, transports: passkey.transports })),
    })
    await writeTwoStep(userId, withChallenge(record, options.challenge, 'sign-in'))
    return options
}

export type PasskeySignIn = { ok: true; accessToken: string; refreshToken: string } | { ok: false; reason: 'refused' | 'too_many' }

// The second step with a passkey: counted with the backup codes, its challenge spent, its signature
// and counter checked, then the session the client holds is raised to aal2 by the hub's recovery factor.
export async function signInWithPasskey(client: SupabaseClient<Database>, userId: string, response: AuthenticationResponseJSON): Promise<PasskeySignIn> {
    if (!(await claimSecondStepTry(userId))) return { ok: false, reason: 'too_many' }
    const stored = await readTwoStep(userId)
    const expectedChallenge = liveChallenge(stored, 'sign-in')
    const record = withoutChallenge(stored)
    if (stored.challenge) await writeTwoStep(userId, record)
    const passkey = record.passkeys?.find(candidate => candidate.credentialId === response.id)
    if (!expectedChallenge || !passkey || !record.recovery) return { ok: false, reason: 'refused' }

    const { rpID, origins } = await relyingParty()
    const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: { id: passkey.credentialId, publicKey: Buffer.from(passkey.publicKey, 'base64url'), counter: passkey.counter, transports: passkey.transports },
    }).catch(() => null)
    if (!verification?.verified) return { ok: false, reason: 'refused' }

    const used = { ...passkey, counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }
    await writeTwoStep(userId, { ...record, passkeys: record.passkeys!.map(candidate => (candidate.id === passkey.id ? used : candidate)) })
    return { ok: true, ...(await elevateSession(client, record.recovery)) }
}
