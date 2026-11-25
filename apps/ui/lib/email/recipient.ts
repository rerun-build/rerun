// No 'server-only', see lib/email/client.ts: the lifecycle emails are sent from Trigger.dev tasks.
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { realEmail } from '@/lib/auth/placeholder-email'
import { undeliverableReason } from './deliverability'

export type EmailRecipient = { email: string; user: User }

// The last gate before an email is built, and the same for every one: an anonymous visitor, an account
// closed or born from a phone has no address, a banned one or one on a domain blocked for abuse is not
// written to, and an address nobody can receive at is never tried.
export async function loadEmailRecipient(supabase: SupabaseClient<Database>, userId: string): Promise<EmailRecipient | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data.user || data.user.is_anonymous || isBanned(data.user)) return null

    const email = realEmail(data.user.email)?.trim()
    if (!email || undeliverableReason(email)) return null

    // Unreadable, the list costs nobody the email they wait for.
    const { data: blocked, error: blockedError } = await supabase.rpc('email_domain_is_blocked', { p_email: email })
    if (blockedError) console.error('[email] email_domain_is_blocked failed', blockedError.message)
    return blocked ? null : { email, user: data.user }
}

function isBanned({ banned_until: until }: User): boolean {
    return !!until && new Date(until).getTime() > Date.now()
}
