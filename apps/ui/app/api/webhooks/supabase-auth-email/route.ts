import { claimAuthEmailSend } from '@/app/api/_services/email-sign-up.service'
import { sendSignInCodeEmail } from '@/app/api/_services/email.service'
import { SIGN_IN_CODE_TTL_MINUTES, mailedSignInUrl, rememberSignInCode } from '@/app/api/_services/sign-in-code.service'
import type { EmailOtpType } from '@supabase/supabase-js'
import { normalizeEmail } from '@/lib/email'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { Webhook } from 'standardwebhooks'

type SendEmailHookPayload = {
    user: { id: string; email?: string; new_email?: string }
    email_data: {
        token: string
        token_hash: string
        token_new: string
        token_hash_new: string
        email_action_type: string
    }
}

type AuthEmail = { to: string; code: string; tokenHash: string; type: EmailOtpType }

const SIGN_IN_ACTIONS = new Set<string>(['signup', 'magiclink', 'email'])

// The email_change hashes are named backwards for compatibility: `token_hash_new` pairs with the
// current address and `token`, `token_hash` with the new address and `token_new`. An anonymous user
// claiming an email has no current address, so only the second email goes out, and Supabase then
// fills `token` rather than `token_new`.
function emailsFor({ user, email_data: data }: SendEmailHookPayload): AuthEmail[] {
    if (SIGN_IN_ACTIONS.has(data.email_action_type) && user.email) {
        return [{ to: user.email, code: data.token, tokenHash: data.token_hash, type: data.email_action_type as EmailOtpType }]
    }
    if (data.email_action_type === 'email_change') {
        const emails: AuthEmail[] = []
        if (user.email && data.token_hash_new) emails.push({ to: user.email, code: data.token, tokenHash: data.token_hash_new, type: 'email_change' })
        if (user.new_email) emails.push({ to: user.new_email, code: data.token_new || data.token, tokenHash: data.token_hash, type: 'email_change' })
        return emails
    }
    return []
}

function hookError(status: number, message: string) {
    return Response.json({ error: { http_code: status, message } }, { status })
}

// Supabase Auth's Send Email Hook: every auth email is rendered here and sent through Resend.
export async function POST(req: Request) {
    const secret = process.env.SEND_EMAIL_HOOK_SECRET
    if (!secret) return hookError(500, 'SEND_EMAIL_HOOK_SECRET is not set')

    let payload: SendEmailHookPayload
    try {
        payload = new Webhook(secret.replace('v1,whsec_', '')).verify(await req.text(), Object.fromEntries(req.headers)) as SendEmailHookPayload
    } catch {
        return hookError(401, 'Invalid signature')
    }

    const emails = emailsFor(payload)
    if (emails.length === 0) {
        console.warn(`[auth-email] no email sent for action ${payload.email_data.email_action_type}`)
        return Response.json({})
    }

    // A brand-new account has no language of its own yet and reads English.
    const locale = await recipientLocale(createServiceRoleClient(), payload.user.id, null)
    for (const email of emails) {
        if (!(await claimAuthEmailSend(normalizeEmail(email.to)))) return hookError(429, 'Too many codes were sent to this address. Try again later.')
        const signInUrl = mailedSignInUrl(email.tokenHash, email.type, payload.user)
        const sent = await sendSignInCodeEmail({ to: email.to, code: email.code, signInUrl, expiresInMinutes: SIGN_IN_CODE_TTL_MINUTES, locale })
        if (!sent.ok) return hookError(502, 'We could not send the email. Please try again.')
        await rememberSignInCode({ email: email.to, userId: payload.user.id, type: email.type, code: email.code, tokenHash: email.tokenHash })
    }
    return Response.json({})
}
