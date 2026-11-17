'use server'

import { claimEmailCodeAsk, ensureEmailAccount, lookupEmailForSignUp } from '@/app/api/_services/email-sign-up.service'
import { resendSignInCodeIfLive } from '@/app/api/_services/sign-in-code.service'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import { callerIp } from '@/lib/auth/caller-ip'
import { EMAIL_PREPARATION_CODES, type EmailPreparationFailure } from '@/lib/auth/email-sign-in-messages'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'
import { PENDING_INVITE_COOKIE } from '@/lib/auth/pending-invite'
import { verifyCaptcha } from '@/lib/auth/captcha'
import { captchaProofSchema, type CaptchaProof } from '@/lib/auth/captcha-proof'
import { drawPriceArm } from '@rerun/cloud/billing'
import { normalizeEmail } from '@/lib/email'
import { createClient } from '@/supabase/server'
import { EXPERIMENT_COOKIE } from '@rerun/analytics/experiments'
import { CONSENT_COOKIE } from '@rerun/contracts'
import { LOCALE_COOKIE, resolveLocale } from '@rerun/i18n'
import { cookies, headers } from 'next/headers'
import { z } from 'zod'

// Asked before every new code: Supabase voids the previous code each time it mints one, so while
// the last one is still good it is mailed again instead. `resent: false` means ask Supabase, `held`
// that the last one left less than a minute ago and nothing new was mailed.
export async function resendLiveSignInCode(email: string): Promise<{ resent: boolean; held: boolean }> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    const outcome = await resendSignInCodeIfLive(normalizeEmail(email), data.user?.id ?? null)
    return { resent: outcome !== null, held: outcome === 'held' }
}

const prepareSchema = z.object({ email: z.string().trim().email().max(320), captcha: captchaProofSchema.optional() })

export type EmailSignInPreparation = { ok: true; created: boolean } | (ActionFailure & { reason: EmailPreparationFailure })

const preparationRefused = (reason: EmailPreparationFailure) => ({ ...failure(EMAIL_PREPARATION_CODES[reason]), reason })

// What every ask for a code goes through before Supabase hears of it: the robot check, then the pace
// of the network behind the caller. `null` when the caller may go on.
async function refuseCodeAsk(captcha: CaptchaProof | undefined): Promise<{ ip: string; refusal: EmailPreparationFailure | null }> {
    const ip = callerIp(await headers())
    if (!(await verifyCaptcha(captcha, ip))) return { ip, refusal: 'captcha_failed' }
    if (!(await claimEmailCodeAsk(ip))) return { ip, refusal: 'too_many_codes' }
    return { ip, refusal: null }
}

// Called before Supabase is asked for a new code, which it then mails to an account that exists.
export async function prepareEmailSignIn(input: z.input<typeof prepareSchema>): Promise<EmailSignInPreparation> {
    const parsed = prepareSchema.safeParse(input)
    if (!parsed.success) return preparationRefused('invalid_email')

    const { ip, refusal } = await refuseCodeAsk(parsed.data.captcha)
    if (refusal) return preparationRefused(refusal)

    const result = await ensureEmailAccount(normalizeEmail(parsed.data.email), ip)
    return result.ok ? result : preparationRefused(result.error)
}

export type AnonymousEmailPreparation = { ok: true; exists: boolean } | (ActionFailure & { reason: EmailPreparationFailure })

// The address an anonymous visitor claims goes through the same gate as the auth page's, and the
// domain rule with it. Whether the address has an account is what the visitor's browser needs next:
// a known one is signed into, a new one is claimed on the anonymous user. It is only said past the
// robot check and the pace, like `created` above.
export async function prepareAnonymousEmailStep(input: z.input<typeof prepareSchema>): Promise<AnonymousEmailPreparation> {
    const parsed = prepareSchema.safeParse(input)
    if (!parsed.success) return preparationRefused('invalid_email')

    const { refusal } = await refuseCodeAsk(parsed.data.captcha)
    if (refusal) return preparationRefused(refusal)

    const lookup = await lookupEmailForSignUp(normalizeEmail(parsed.data.email))
    return lookup.ok ? lookup : preparationRefused(lookup.error)
}

export type SignupCompletion = { ok: true; signedUp: boolean } | { ok: false }

// The browser converts the anonymous session on its own, and the server stamps the signup on
// whichever request comes next. This is that request, made so the signup form can wait for the
// stamp instead of leaving the tab to learn it from realtime. Same inputs as the middleware's
// provisioning; from `/` alone, so the invite paths are not looked at.
export async function completeSignupAction(): Promise<SignupCompletion> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (!data.user || data.user.is_anonymous) return { ok: false }
    const cookieStore = await cookies()
    const provisioned = await provisionUser(supabase, data.user, {
        phoneStep: !cookieStore.has(PENDING_INVITE_COOKIE),
        priceArm: drawPriceArm({
            experimentCookie: cookieStore.get(EXPERIMENT_COOKIE)?.value,
            consentCookie: cookieStore.get(CONSENT_COOKIE)?.value,
            userAgent: (await headers()).get('user-agent'),
        }),
        locale: resolveLocale({ cookie: cookieStore.get(LOCALE_COOKIE)?.value, acceptLanguage: (await headers()).get('accept-language') }),
    })
    return provisioned ? { ok: true, signedUp: provisioned.signedUp } : { ok: false }
}
