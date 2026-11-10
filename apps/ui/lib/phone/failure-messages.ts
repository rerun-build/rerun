import type { PhoneChangeFailure } from '@/app/api/_services/phone-sign-in.service'
import type { PhoneVerificationFailure } from '@/app/api/_services/phone-verification.service'
import { failure, type ErrorCode } from '@/lib/i18n/action-error'

export type PhoneFailure = PhoneVerificationFailure | PhoneChangeFailure | 'captcha_failed' | 'signed_out'

export const PHONE_FAILURE_CODES = {
    taken: 'phoneTaken',
    same_number: 'samePhone',
    not_required: 'phoneAlreadyVerified',
    too_soon: 'codeOnItsWay',
    too_many: 'tooManyPhoneCodes',
    invalid_number: 'invalidMobileNumber',
    unsupported_country: 'phoneCountryUnsupported',
    undeliverable: 'phoneUndeliverable',
    blocked: 'phoneBlocked',
    rate_limited: 'phoneRateLimited',
    wrong_code: 'wrongCode',
    expired: 'codeExpired',
    unavailable: 'phoneUnreachable',
    busy: 'phoneBusy',
    captcha_failed: 'captchaFailed',
    signed_out: 'createAccountFirst',
} as const satisfies Record<PhoneFailure, ErrorCode>

export const PHONE_FAILURE_MESSAGES = Object.fromEntries(Object.entries(PHONE_FAILURE_CODES).map(([reason, code]) => [reason, failure(code).error])) as Record<PhoneFailure, string>
