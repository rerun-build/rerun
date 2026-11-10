'use server'

import { headers } from 'next/headers'
import { z } from 'zod'

import { type PhoneAccount } from '@/app/api/_services/phone-ownership.service'
import { completePhoneChange, completePhoneSignIn, startPhoneChange, startPhoneSignIn, type SessionTokens } from '@/app/api/_services/phone-sign-in.service'
import { skipPhoneVerification } from '@/app/api/_services/phone-verification.service'
import { callerIp } from '@/lib/auth/caller-ip'
import { verifyCaptcha } from '@/lib/auth/captcha'
import { captchaProofSchema } from '@/lib/auth/captcha-proof'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'
import { PHONE_FAILURE_CODES, type PhoneFailure } from '@/lib/phone/failure-messages'
import { isPhoneCountry, toE164 } from '@/lib/phone/normalize'
import { VERIFICATION_CODE_LENGTH, verificationLanguage, type VerificationChannel } from '@/lib/phone/verification'
import { createClient } from '@/supabase/server'

// `reason` is what the client reports to analytics, `error` what it shows.
export type PhoneActionRefusal = ActionFailure & { reason: PhoneFailure; retryAfterSeconds?: number }
export type PhoneActionResult = { ok: true } | PhoneActionRefusal
export type PhoneSendActionResult = { ok: true; channel: VerificationChannel } | PhoneActionRefusal
export type PhoneSignInActionResult = { ok: true; created: boolean; session: SessionTokens } | PhoneActionRefusal

const sendSchema = z.object({
    phone: z.string().trim().min(1).max(32),
    country: z.string().refine(isPhoneCountry),
    channel: z.enum(['sms', 'whatsapp']),
})

const signInSendSchema = sendSchema.extend({ captcha: captchaProofSchema.optional() })

const signInSchema = sendSchema.extend({ code: z.string().regex(new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`)) })

const numberSchema = sendSchema.omit({ channel: true })

const refused = (reason: PhoneFailure, retryAfterSeconds?: number): PhoneActionRefusal => ({
    ...failure(PHONE_FAILURE_CODES[reason]),
    reason,
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
})

const invalidNumber = () => refused('invalid_number')

// The logs keep why a send was turned away, beside what Bird answered.
function sendRefused(result: { error: PhoneFailure; retryAfterSeconds?: number }, { channel, country }: { channel: VerificationChannel; country: string }): PhoneActionRefusal {
    console.warn('[phone] send refused', result.error, channel, country)
    return refused(result.error, result.retryAfterSeconds)
}

const callerLanguage = (requestHeaders: Headers) => verificationLanguage(requestHeaders.get('accept-language'))

async function accountUserId(): Promise<string | null> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    return data.user && !data.user.is_anonymous ? data.user.id : null
}

export async function skipPhoneStepAction(): Promise<PhoneActionResult> {
    const userId = await accountUserId()
    if (!userId) return refused('signed_out')
    return (await skipPhoneVerification(userId)) ? { ok: true } : refused('unavailable')
}

// The phone wall's "Continue": the number is kept as typed, without a code.
export async function savePhoneNumberAction(input: z.input<typeof numberSchema>): Promise<PhoneActionResult> {
    const parsed = numberSchema.safeParse(input)
    const phone = parsed.success ? signInPhone(parsed.data) : null
    if (!phone) return invalidNumber()

    const userId = await accountUserId()
    if (!userId) return refused('signed_out')
    return (await skipPhoneVerification(userId, phone)) ? { ok: true } : refused('unavailable')
}

function signInPhone(input: { phone: string; country: string }): string | null {
    return isPhoneCountry(input.country) ? toE164(input.phone, input.country) : null
}

export async function sendPhoneSignInCodeAction(input: z.input<typeof signInSendSchema>): Promise<PhoneSendActionResult> {
    const parsed = signInSendSchema.safeParse(input)
    const phone = parsed.success ? signInPhone(parsed.data) : null
    if (!parsed.success || !phone) return invalidNumber()

    const requestHeaders = await headers()
    const ip = callerIp(requestHeaders)
    if (!(await verifyCaptcha(parsed.data.captcha, ip))) return refused('captcha_failed')

    const result = await startPhoneSignIn(phone, parsed.data.channel, ip, callerLanguage(requestHeaders))
    return result.ok ? result : sendRefused(result, parsed.data)
}

// Signs the visitor into the account this number holds, or creates it.
export async function verifyPhoneSignInCodeAction(input: z.input<typeof signInSchema>): Promise<PhoneSignInActionResult> {
    const parsed = signInSchema.safeParse(input)
    const phone = parsed.success ? signInPhone(parsed.data) : null
    if (!parsed.success || !phone) return refused('wrong_code')

    const result = await completePhoneSignIn(await createClient(), phone, parsed.data.code, parsed.data.channel)
    return result.ok ? result : refused(result.error)
}

async function signedInAccount(): Promise<PhoneAccount | null> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    return data.user && !data.user.is_anonymous ? { id: data.user.id, email: data.user.email ?? null } : null
}

const signInFirst = (): PhoneActionRefusal => ({ ...failure('signInToChangeNumber'), reason: 'signed_out' })

// The number a signed-in account adds or moves to, from its account settings.
export async function sendPhoneChangeCodeAction(input: z.input<typeof sendSchema>): Promise<PhoneSendActionResult> {
    const parsed = sendSchema.safeParse(input)
    const phone = parsed.success ? signInPhone(parsed.data) : null
    if (!parsed.success || !phone) return invalidNumber()

    const account = await signedInAccount()
    if (!account) return signInFirst()

    const requestHeaders = await headers()
    const result = await startPhoneChange(account, phone, parsed.data.channel, callerIp(requestHeaders), callerLanguage(requestHeaders))
    return result.ok ? result : sendRefused(result, parsed.data)
}

export async function verifyPhoneChangeCodeAction(input: z.input<typeof signInSchema>): Promise<PhoneActionResult> {
    const parsed = signInSchema.safeParse(input)
    const phone = parsed.success ? signInPhone(parsed.data) : null
    if (!parsed.success || !phone) return refused('wrong_code')

    const account = await signedInAccount()
    if (!account) return signInFirst()

    const result = await completePhoneChange(account, phone, parsed.data.code, parsed.data.channel)
    return result.ok ? result : refused(result.error)
}
