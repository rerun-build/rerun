import 'server-only'
import { callerRateKey } from '@/lib/auth/caller-ip'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export const MAX_SIGN_UPS_PER_IP = 10
const SIGN_UP_WINDOW_SECONDS = 60 * 60
export const MAX_CODE_ASKS_PER_IP = 30
export const MAX_AUTH_EMAILS_PER_ADDRESS = 10

export async function claimEmailCodeAsk(ip: string): Promise<boolean> {
    const { data, error } = await createServiceRoleClient().rpc('claim_email_sign_up', { p_ip: `code:${callerRateKey(ip)}`, p_ip_max: MAX_CODE_ASKS_PER_IP, p_window_seconds: SIGN_UP_WINDOW_SECONDS })
    return !error && data === true
}

export async function claimAuthEmailSend(email: string): Promise<boolean> {
    const { data, error } = await createServiceRoleClient().rpc('claim_email_sign_up', { p_ip: `mail:${email}`, p_ip_max: MAX_AUTH_EMAILS_PER_ADDRESS, p_window_seconds: SIGN_UP_WINDOW_SECONDS })
    if (error) {
        console.error('[email-sign-up] claim_email_sign_up (per address) failed', error.message)
        return true
    }
    return data === true
}

export type EmailAccountFailure = 'blocked_domain' | 'not_allowed' | 'too_many' | 'unavailable'

export function signUpAllowed(email: string): boolean {
    const entries = (process.env.SIGN_UP_EMAILS ?? '').split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean)
    if (entries.length === 0) return true
    const address = email.toLowerCase()
    return entries.some(entry => (entry.startsWith('@') ? address.endsWith(entry) : entry === address))
}
export type EmailAccountResult = { ok: true; created: boolean } | { ok: false; error: EmailAccountFailure }

const refused = (error: EmailAccountFailure) => ({ ok: false as const, error })

export type EmailLookupResult = { ok: true; exists: boolean } | { ok: false; error: EmailAccountFailure }

async function hasPendingInvitation(admin: ReturnType<typeof createServiceRoleClient>, email: string): Promise<boolean> {
    const { data, error } = await selectMaybeSingle(admin, 'workspace_invitations', ['id'] as const, {
        email: email.toLowerCase(),
        status: 'pending',
        expires_at: { gt: new Date().toISOString() },
    })
    if (error) {
        console.error('[email-sign-up] workspace_invitations lookup failed', error.message)
        return false
    }
    return data !== null
}

export async function lookupEmailForSignUp(email: string): Promise<EmailLookupResult> {
    const admin = createServiceRoleClient()
    const { data: exists, error: existsError } = await admin.rpc('check_email_exists', { email })
    if (existsError) {
        console.error('[email-sign-up] check_email_exists failed', existsError.message)
        return refused('unavailable')
    }
    if (exists) return { ok: true, exists: true }
    if (!signUpAllowed(email) && !(await hasPendingInvitation(admin, email))) return refused('not_allowed')

    const { data: blocked, error: blockedError } = await admin.rpc('email_domain_is_blocked', { p_email: email })
    if (blockedError) {
        console.error('[email-sign-up] email_domain_is_blocked failed', blockedError.message)
        return refused('unavailable')
    }
    if (blocked) return refused('blocked_domain')
    return { ok: true, exists: false }
}

export async function ensureEmailAccount(email: string, ip: string): Promise<EmailAccountResult> {
    const lookup = await lookupEmailForSignUp(email)
    if (!lookup.ok) return lookup
    if (lookup.exists) return { ok: true, created: false }

    const admin = createServiceRoleClient()
    const { data: claimed, error: claimError } = await admin.rpc('claim_email_sign_up', { p_ip: callerRateKey(ip), p_ip_max: MAX_SIGN_UPS_PER_IP, p_window_seconds: SIGN_UP_WINDOW_SECONDS })
    if (claimError) {
        console.error('[email-sign-up] claim_email_sign_up failed', claimError.message)
        return refused('unavailable')
    }
    if (!claimed) return refused('too_many')

    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (error && error.code !== 'email_exists') {
        console.error('[email-sign-up] account creation failed', error.message)
        return refused('unavailable')
    }
    return { ok: true, created: !error }
}
