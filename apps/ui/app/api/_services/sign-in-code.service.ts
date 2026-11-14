import 'server-only'
import type { Database } from '@/app/api/database.types'
import { sendSignInCodeEmail } from '@rerun/cloud/email'
import { normalizeEmail } from '@/lib/email'
import { APP_URL } from '@/lib/app-url'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { User } from '@supabase/supabase-js'

export const SIGN_IN_CODE_TTL_MINUTES = 15
const MIN_MINUTES_LEFT_TO_RESEND = 5
const MAX_SENDS_PER_CODE = 5
const MIN_RESEND_INTERVAL_MS = 60_000
const SENT_AT_SLACK_MS = 60_000

const SIGN_IN_CODE_COLUMNS = ['email', 'user_id', 'type', 'code', 'token_hash', 'issued_at', 'expires_at', 'last_sent_at', 'send_count'] as const

type SignInCodeRow = Pick<Database['public']['Tables']['sign_in_codes']['Row'], (typeof SIGN_IN_CODE_COLUMNS)[number]>

export const signInUrlFor = (tokenHash: string, type: string) => `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`

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

export function mailedSignInUrl(tokenHash: string, type: string, user: { email?: string }): string | undefined {
    return type === 'email_change' && user.email ? undefined : signInUrlFor(tokenHash, type)
}

const isAfter = (date: string | undefined, time: number) => !!date && Date.parse(date) > time

function isStillLive(row: SignInCodeRow, user: User) {
    const issuedAt = Date.parse(row.issued_at)
    const address = row.type === 'email_change' ? user.new_email : user.email
    if (normalizeEmail(address ?? '') !== row.email) return false
    if (isAfter(user.last_sign_in_at, issuedAt)) return false
    const replacedAfter = issuedAt + SENT_AT_SLACK_MS
    return !isAfter(user.recovery_sent_at, replacedAfter) && !isAfter(user.confirmation_sent_at, replacedAfter) && !isAfter(user.email_change_sent_at, replacedAfter)
}

export async function resendSignInCodeIfLive(email: string, sessionUserId: string | null): Promise<'sent' | 'held' | null> {
    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'sign_in_codes', SIGN_IN_CODE_COLUMNS, { email: normalizeEmail(email) })
    if (!row) return null

    const now = Date.now()
    const minutesLeft = Math.floor((Date.parse(row.expires_at) - now) / 60_000)
    if (minutesLeft < MIN_MINUTES_LEFT_TO_RESEND || row.send_count >= MAX_SENDS_PER_CODE) return null
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
