import 'server-only'
import type { Database } from '@/app/api/database.types'
import { sendSignInCodeEmail } from '@rerun/cloud/email'
import { normalizeEmail } from '@/lib/email'
import { APP_URL } from '@/lib/app-url'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { User } from '@supabase/supabase-js'

// Mirrors auth.email.otp_expiry (900 s) in supabase/config.toml and on the hosted projects.
export const SIGN_IN_CODE_TTL_MINUTES = 15
// Below this, mailing the same code again would hand over one about to die: a fresh one is minted.
const MIN_MINUTES_LEFT_TO_RESEND = 5
const MAX_SENDS_PER_CODE = 5
// Mirrors auth.email.max_frequency, the pace Supabase itself holds a new code to.
const MIN_RESEND_INTERVAL_MS = 60_000
// Supabase stamps its *_sent_at once the hook has answered, so a moment after issued_at.
const SENT_AT_SLACK_MS = 60_000

const SIGN_IN_CODE_COLUMNS = ['email', 'user_id', 'type', 'code', 'token_hash', 'issued_at', 'expires_at', 'last_sent_at', 'send_count'] as const

type SignInCodeRow = Pick<Database['public']['Tables']['sign_in_codes']['Row'], (typeof SIGN_IN_CODE_COLUMNS)[number]>

export const signInUrlFor = (tokenHash: string, type: string) => `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`

// Best effort: the email is already out, and a code that is not remembered only means the next
// request mints a new one, as it did before this table existed.
export async function rememberSignInCode(input: { email: string; userId: string; type: string; code: string; tokenHash: string }) {
    try {
        const supabase = createServiceRoleClient()
        const now = new Date()
        const { error } = await supabase.from('sign_in_codes').upsert<Database['public']['Tables']['sign_in_codes']['Insert']>(
            {
                email: normalizeEmail(input.email),
                user_id: input.userId,
                type: input.type,
                code: input.code,
                token_hash: input.tokenHash,
                issued_at: now.toISOString(),
                expires_at: new Date(now.getTime() + SIGN_IN_CODE_TTL_MINUTES * 60_000).toISOString(),
                last_sent_at: now.toISOString(),
                send_count: 1,
            },
            { onConflict: 'email' },
        )
        if (error) console.error('[sign-in-code] could not remember the code', error)
        await supabase.from('sign_in_codes').delete().lt('expires_at', now.toISOString())
    } catch (error) {
        console.error('[sign-in-code] could not remember the code', error)
    }
}

// An account that moves to a new address is already signed in and types the code where it asked
// for it: the link of the email only signs in, which it has no use for. An anonymous visitor
// claiming an address is signing up, and keeps the link. What tells them apart is the address the
// account already has, the visitor having none.
export function mailedSignInUrl(tokenHash: string, type: string, user: { email?: string }): string | undefined {
    return type === 'email_change' && user.email ? undefined : signInUrlFor(tokenHash, type)
}

const isAfter = (date: string | undefined, time: number) => !!date && Date.parse(date) > time

// Supabase never says whether a code is still good, so this reads it off the user: a sign-in since
// the code went out spent it, and a later *_sent_at means another code replaced it without passing
// through the hook (the admin impersonation link does).
function isStillLive(row: SignInCodeRow, user: User) {
    const issuedAt = Date.parse(row.issued_at)
    const address = row.type === 'email_change' ? user.new_email : user.email
    if (normalizeEmail(address ?? '') !== row.email) return false
    if (isAfter(user.last_sign_in_at, issuedAt)) return false
    const replacedAfter = issuedAt + SENT_AT_SLACK_MS
    return !isAfter(user.recovery_sent_at, replacedAfter) && !isAfter(user.confirmation_sent_at, replacedAfter) && !isAfter(user.email_change_sent_at, replacedAfter)
}

// `sent` when the address already holds a code that is still good and it was mailed again, `held`
// when that code left less than a minute ago and nothing was mailed. Null means the caller has to
// ask Supabase for a new one.
export async function resendSignInCodeIfLive(email: string, sessionUserId: string | null): Promise<'sent' | 'held' | null> {
    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'sign_in_codes', SIGN_IN_CODE_COLUMNS, { email: normalizeEmail(email) })
    if (!row) return null

    const now = Date.now()
    const minutesLeft = Math.floor((Date.parse(row.expires_at) - now) / 60_000)
    if (minutesLeft < MIN_MINUTES_LEFT_TO_RESEND || row.send_count >= MAX_SENDS_PER_CODE) return null
    // The code that confirms an anonymous visitor's email signs in as that visitor, so only they get it again.
    if (row.type === 'email_change' && row.user_id !== sessionUserId) return null

    const { data } = await supabase.auth.admin.getUserById(row.user_id)
    if (!data.user || !isStillLive(row, data.user)) {
        await supabase.from('sign_in_codes').delete().eq('email', row.email)
        return null
    }

    if (now - Date.parse(row.last_sent_at) < MIN_RESEND_INTERVAL_MS) return 'held'

    const locale = await recipientLocale(supabase, row.user_id, null)
    const sent = await sendSignInCodeEmail({ to: row.email, code: row.code, signInUrl: mailedSignInUrl(row.token_hash, row.type, data.user), expiresInMinutes: minutesLeft, locale })
    if (!sent.ok) return null

    await supabase
        .from('sign_in_codes')
        .update<Database['public']['Tables']['sign_in_codes']['Update']>({ last_sent_at: new Date(now).toISOString(), send_count: row.send_count + 1 })
        .eq('email', row.email)
    return 'sent'
}
