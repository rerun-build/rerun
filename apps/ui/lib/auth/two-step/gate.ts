import type { Database } from '@/app/api/database.types'
import { TWO_STEP_RECOVERY_FACTOR_NAME } from '@rerun/contracts'
import type { SupabaseClient, User } from '@supabase/supabase-js'

export const TWO_STEP_PATH = '/auth/two-step'

// The method this browser went through last, which its next sign-in offers first.
export const TWO_STEP_LAST_COOKIE = 'rr_two_step_last'

type AppMetadata = Record<string, unknown> | null | undefined

// Written by the hub with the service role when the first method is set up, removed with the last
// one, so it rides in every token: no query tells whether an account asks for a second step.
export function hasTwoStep(appMetadata: AppMetadata): boolean {
    return appMetadata?.two_step === true
}

// The flag, or a method of the person's own that a setup cut short left without it: either way the
// account is opened by that method only.
export function asksSecondStep(user: Pick<User, 'app_metadata' | 'factors'>): boolean {
    return hasTwoStep(user.app_metadata) || (user.factors ?? []).some(factor => factor.status === 'verified' && factor.friendly_name !== TWO_STEP_RECOVERY_FACTOR_NAME)
}

// Signed in with the first method only: the account is not open yet.
export function awaitsSecondStep(appMetadata: AppMetadata, aal: string | null | undefined): boolean {
    return hasTwoStep(appMetadata) && aal !== 'aal2'
}

// What a token says, read without checking it: only once the auth server has vouched for the session
// it belongs to.
function tokenPayload(token: string | null | undefined): { app_metadata?: Record<string, unknown>; aal?: unknown } {
    try {
        return JSON.parse(Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8'))
    } catch {
        return {}
    }
}

export function tokenHasTwoStep(token: string | null | undefined): boolean {
    return hasTwoStep(tokenPayload(token).app_metadata)
}

// The session's own token, read locally.
export async function sessionLevel(supabase: SupabaseClient<Database>): Promise<string | null> {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    return data?.currentLevel ?? null
}

// The account as the auth server holds it, and whether this session still owes its second step. The
// flag is read from the account rather than the token: it holds from the moment it is written. A token
// handed over has just been checked by the auth server, so its level is read from it.
export async function readAccount(supabase: SupabaseClient<Database>, token?: string | null): Promise<{ user: User; pending: boolean } | null> {
    const { data } = await supabase.auth.getUser(token ?? undefined)
    const user = data.user
    if (!user) return null
    if (!asksSecondStep(user)) return { user, pending: false }
    const level = token ? tokenPayload(token).aal : await sessionLevel(supabase)
    return { user, pending: level !== 'aal2' }
}

// The account, or null while its second step is still owed: what every check of "who is this" uses.
export async function readSettledUser(supabase: SupabaseClient<Database>, token?: string | null): Promise<User | null> {
    const account = await readAccount(supabase, token)
    return account && !account.pending ? account.user : null
}
