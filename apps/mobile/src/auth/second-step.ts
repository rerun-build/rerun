import { mobileApi, TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import type { AuthenticatorAssuranceLevels, Factor, User } from '@supabase/supabase-js'

import { ApiError, hub } from '@/api/client'
import { supabase } from '@/auth/supabase'
import { environment } from '@/config/environment'

// The passkeys are the hub's, never Supabase factors: whether the account has any comes from the hub.
export type SecondStepMethods = { appFactorId: string | null; hasPasskeys: boolean }

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

export function appFactorOf(factors: Factor[]): string | null {
    return factors.find(factor => own(factor) && factor.factor_type === 'totp')?.id ?? null
}

export async function readSecondStepMethods(): Promise<SecondStepMethods> {
    const [{ data }, options] = await Promise.all([supabase.auth.mfa.listFactors(), passkeyDomain() ? readPasskeyOptions() : null])
    return { appFactorId: appFactorOf(data?.all ?? []), hasPasskeys: options !== null }
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

// The options of a sign-in by passkey for this session, null when the account has none.
async function readPasskeyOptions() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return null
    try {
        return (await hub(mobileApi.passkeyOptions, { accessToken: data.session.access_token })).options
    } catch {
        return null
    }
}

export type PasskeyOutcome = 'ok' | 'refused' | 'too_many'

// The hub checks the passkey: its options go to the native passkey sheet as they are, and the sheet's
// signed answer goes back with the session, which the hub raises and hands back.
export async function verifyWithPasskey(): Promise<PasskeyOutcome> {
    const Passkeys = nativePasskeys()
    const options = Passkeys && passkeyDomain() ? await readPasskeyOptions() : null
    if (!Passkeys || !options) return 'refused'
    const assertion = await Passkeys.get(options).catch(() => null)
    const { data } = await supabase.auth.getSession()
    if (!assertion || !data.session) return 'refused'
    try {
        const { session } = await hub(mobileApi.signInWithPasskey, { accessToken: data.session.access_token, body: { assertion, refreshToken: data.session.refresh_token } })
        const { error } = await supabase.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken })
        return error ? 'refused' : 'ok'
    } catch (error) {
        return error instanceof ApiError && error.status === 429 ? 'too_many' : 'refused'
    }
}
