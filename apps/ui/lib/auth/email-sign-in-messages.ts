import type { EmailAccountFailure } from '@/app/api/_services/email-sign-up.service'
import { failure, type ErrorCode } from '@/lib/i18n/action-error'

export type EmailPreparationFailure = EmailAccountFailure | 'invalid_email' | 'captcha_failed' | 'too_many_codes'

export const EMAIL_PREPARATION_CODES = {
    invalid_email: 'invalidEmailNoDot',
    captcha_failed: 'captchaFailed',
    blocked_domain: 'emailDomainBlocked',
    too_many: 'tooManyAccountsFromNetwork',
    too_many_codes: 'tooManyCodesFromNetwork',
    unavailable: 'sendCodeFailed',
} as const satisfies Record<EmailPreparationFailure, ErrorCode>

export const EMAIL_PREPARATION_MESSAGES = Object.fromEntries(Object.entries(EMAIL_PREPARATION_CODES).map(([reason, code]) => [reason, failure(code).error])) as Record<EmailPreparationFailure, string>
