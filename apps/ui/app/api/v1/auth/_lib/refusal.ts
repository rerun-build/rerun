import { EMAIL_PREPARATION_MESSAGES, type EmailPreparationFailure } from '@/lib/auth/email-sign-in-messages'
import { PHONE_FAILURE_MESSAGES, type PhoneFailure } from '@/lib/phone/failure-messages'
import type { SignInRefusal } from '@rerun/contracts'

const STATUS_BY_REASON: Partial<Record<PhoneFailure | EmailPreparationFailure, number>> = {
    too_soon: 429,
    too_many: 429,
    rate_limited: 429,
    busy: 503,
    unavailable: 503,
    unsupported_country: 422,
    undeliverable: 422,
    channel_unavailable: 422,
    blocked: 422,
    blocked_domain: 422,
}

function refusal(reason: PhoneFailure | EmailPreparationFailure, error: string, retryAfterSeconds?: number): Response {
    const body: SignInRefusal = { error, reason, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }
    return Response.json(body, { status: STATUS_BY_REASON[reason] ?? 400 })
}

export function phoneRefused(reason: PhoneFailure, retryAfterSeconds?: number): Response {
    return refusal(reason, PHONE_FAILURE_MESSAGES[reason], retryAfterSeconds)
}

export function emailRefused(reason: EmailPreparationFailure): Response {
    return refusal(reason, EMAIL_PREPARATION_MESSAGES[reason])
}
