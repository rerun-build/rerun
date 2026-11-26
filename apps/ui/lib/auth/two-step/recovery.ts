import 'server-only'

import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import type { TwoStepRecord } from './record'
import { openSecret, sealSecret } from './seal'
import { totp } from './totp'

// Supabase raises a session to aal2 only when one of its factors is verified on it, and nothing in
// its admin API does it for the hub. So the hub holds a factor of its own on every account with
// two-step: an authenticator app nobody scans, whose secret only the hub can open. It is set up with
// the person's own aal2 session, when they set up their first method, and used when they spend a
// backup code or when the desktop app opens the session the browser approved at aal2.
export async function enrollRecoveryFactor(client: SupabaseClient<Database>): Promise<NonNullable<TwoStepRecord['recovery']>> {
    const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: TWO_STEP_RECOVERY_FACTOR_NAME })
    if (error || !data) throw new Error(error?.message ?? 'Could not set up the recovery factor')
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) })
    if (verifyError) {
        await client.auth.mfa.unenroll({ factorId: data.id }).catch(() => {})
        throw new Error(verifyError.message)
    }
    return { factorId: data.id, sealedSecret: sealSecret(data.totp.secret) }
}

// Raises the client's session to aal2. A code already spent in this window is refused by the auth
// server, so the next one is tried before giving up.
export async function elevateSession(client: SupabaseClient<Database>, recovery: NonNullable<TwoStepRecord['recovery']>): Promise<{ accessToken: string; refreshToken: string }> {
    const secret = openSecret(recovery.sealedSecret)
    let lastError = 'Could not finish the sign-in'
    for (const stepOffset of [0, 1]) {
        const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId: recovery.factorId, code: totp(secret, Date.now(), stepOffset) })
        if (!error && data) return { accessToken: data.access_token, refreshToken: data.refresh_token }
        lastError = error?.message ?? lastError
    }
    throw new Error(lastError)
}
