import { mobileApi, TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import type { AuthenticatorAssuranceLevels, Factor, MFAVerifyWebauthnParams, User } from '@supabase/supabase-js'

import { ApiError, hub } from '@/api/client'
import { supabase } from '@/auth/supabase'
import { environment } from '@/config/environment'

export type SecondStepMethods = { appFactorId: string | null; passkeyFactorIds: string[] }

const own = (factor: Factor) => factor.status === 'verified' && factor.friendly_name !== TWO_STEP_RECOVERY_FACTOR_NAME

// An account with two-step verification, signed in with its first method only: the hub takes such
// a session for nobody until one of its methods has raised it to aal2. The same test as the hub's
// (asksSecondStep): the flag, or a method of the person's own, never the hub's recovery factor alone.
export function owesSecondStep(level: AuthenticatorAssuranceLevels | null | undefined, user: Pick<User, 'app_metadata' | 'factors'> | null | undefined): boolean {
    if (level !== 'aal1' || !user) return false
    return user.app_metadata?.two_step === true || (user.factors ?? []).some(own)
}

export async function readOwesSecondStep(): Promise<boolean> {
    const [{ data: level }, { data }] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.getSession()])
    return owesSecondStep(level?.currentLevel, data.session?.user)
}

// The most recently used passkey first: a challenge names one of them.
export function methodsOf(factors: Factor[]): SecondStepMethods {
    const mine = factors.filter(own)
    const passkeys = mine.filter(factor => factor.factor_type === 'webauthn').sort((a, b) => (b.last_challenged_at ?? b.created_at).localeCompare(a.last_challenged_at ?? a.created_at))
    return { appFactorId: mine.find(factor => factor.factor_type === 'totp')?.id ?? null, passkeyFactorIds: passkeys.map(factor => factor.id) }
}

export async function readSecondStepMethods(): Promise<SecondStepMethods> {
    const { data } = await supabase.auth.mfa.listFactors()
    return methodsOf(data?.all ?? [])
}

export async function verifyAppCode(factorId: string, code: string): Promise<boolean> {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    return !error
}

export type BackupCodeOutcome = 'ok' | 'wrong' | 'too_many' | 'failed'

// The hub raises the session with its own recovery factor: the app hands it over and takes it back.
export async function spendBackupCode(code: string): Promise<BackupCodeOutcome> {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return 'failed'
    try {
        const { session } = await hub(mobileApi.spendBackupCode, { accessToken: data.session.access_token, body: { code: code.trim(), refreshToken: data.session.refresh_token } })
        const { error } = await supabase.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken })
        return error ? 'failed' : 'ok'
    } catch (error) {
        if (error instanceof ApiError && error.status === 429) return 'too_many'
        if (error instanceof ApiError && error.status === 400) return 'wrong'
        return 'failed'
    }
}

// The domains this build may use passkeys on (its associated domains): Rerun Cloud's hubs. A
// self-hosted hub is not among them, and the app then offers the code and the backup codes only.
const PASSKEY_DOMAINS = (process.env.EXPO_PUBLIC_PASSKEY_DOMAINS ?? '')
    .split(',')
    .map((domain: string) => domain.trim())
    .filter(Boolean)
// The origin Android signs a passkey assertion with: its app's signing key, `android:apk-key-hash:…`.
const ANDROID_ORIGIN = process.env.EXPO_PUBLIC_PASSKEY_ANDROID_ORIGIN

type PasskeysModule = typeof import('react-native-passkeys')

// Loaded on first use: a build made before the native module was added has no passkeys, and the
// rest of the second step still works there.
function nativePasskeys(): PasskeysModule | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('react-native-passkeys') as PasskeysModule
    } catch {
        return null
    }
}

export function passkeyDomain(): string | null {
    const host = new URL(environment.apiUrl).hostname
    return PASSKEY_DOMAINS.includes(host) && nativePasskeys()?.isSupported() ? host : null
}

function base64url(buffer: ArrayBuffer | ArrayBufferView): string {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Supabase's client turns the challenge into the browser's buffers; the native passkey sheet takes
// the JSON form back, and its answer goes to Supabase as a credential that serializes itself.
export async function verifyWithPasskey(factorId: string): Promise<boolean> {
    const rpId = passkeyDomain()
    const Passkeys = nativePasskeys()
    if (!rpId || !Passkeys) return false
    const rpOrigins = [`https://${rpId}`, ...(ANDROID_ORIGIN ? [ANDROID_ORIGIN] : [])]
    const { data: challenge, error } = await supabase.auth.mfa.challenge({ factorId, webauthn: { rpId, rpOrigins } })
    if (error || !challenge || challenge.type !== 'webauthn' || challenge.webauthn.type !== 'request') return false
    const options = challenge.webauthn.credential_options.publicKey
    const assertion = await Passkeys.get({
        rpId,
        challenge: base64url(options.challenge),
        timeout: options.timeout,
        userVerification: options.userVerification,
        allowCredentials: options.allowCredentials?.map(credential => ({ id: base64url(credential.id), type: 'public-key' as const })),
    }).catch(() => null)
    if (!assertion) return false
    const credential = { toJSON: () => assertion } as unknown as MFAVerifyWebauthnParams<'request'>['webauthn']['credential_response']
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, webauthn: { type: 'request', rpId, rpOrigins, credential_response: credential } })
    return !verifyError
}
