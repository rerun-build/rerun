import type { EmailAccountFailure } from '@/app/api/_services/email-sign-up.service'

export type EmailPreparationFailure = EmailAccountFailure | 'invalid_email' | 'captcha_failed' | 'too_many_codes'

export const EMAIL_PREPARATION_MESSAGES: Record<EmailPreparationFailure, string> = {
    invalid_email: 'Enter a valid email',
    captcha_failed: 'We could not confirm you are not a robot. Try again.',
    blocked_domain: 'This email domain is not accepted. Use another address.',
    too_many: 'Too many accounts were created from your network. Try again later.',
    too_many_codes: 'Too many codes were asked from your network. Try again later.',
    unavailable: 'We could not send your code. Try again.',
}
