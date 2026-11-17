'use server'

import { claimEmailCodeAsk, ensureEmailAccount } from '@/app/api/_services/email-sign-up.service'
import { resendSignInCodeIfLive } from '@/app/api/_services/sign-in-code.service'
import { callerIp } from '@/lib/auth/caller-ip'
import { EMAIL_PREPARATION_CODES, type EmailPreparationFailure } from '@/lib/auth/email-sign-in-messages'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'
import { verifyCaptcha } from '@/lib/auth/captcha'
import { captchaProofSchema, type CaptchaProof } from '@/lib/auth/captcha-proof'
import { normalizeEmail } from '@/lib/email'
import { createClient } from '@/supabase/server'
import { headers } from 'next/headers'
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
