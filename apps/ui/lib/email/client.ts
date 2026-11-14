import { Resend } from 'resend'

import { DEFAULT_SENDERS } from '@rerun/cloud/senders'
import { APP_URL } from '@/lib/app-url'

export { APP_URL, notificationUrl } from '@/lib/app-url'

export const TRANSACTIONAL_FROM = process.env.RESEND_FROM ?? DEFAULT_SENDERS.transactional
export const EXPERTS_FROM = process.env.RESEND_EXPERTS_FROM ?? DEFAULT_SENDERS.experts
export const MARKETING_FROM = process.env.RESEND_MARKETING_FROM ?? DEFAULT_SENDERS.marketing
export const NEWSLETTER_FROM = process.env.RESEND_NEWSLETTER_FROM ?? MARKETING_FROM
export const REPLY_TO = process.env.RESEND_REPLY_TO ?? DEFAULT_SENDERS.replyTo

export type SendEmailResult = { ok: true; id: string | null; skipped?: boolean } | { ok: false; error: string }

export function redirectDelivery(to: string, subject: string): { to: string; subject: string } {
    const inbox = process.env.EMAIL_REDIRECT_TO
    if (!inbox) return { to, subject }
    return { to: inbox, subject: `[staging → ${to}] ${subject}` }
}

export const IS_PRODUCTION_MAILER = process.env.NODE_ENV === 'production' && !process.env.EMAIL_REDIRECT_TO

let client: Resend | null = null

export function getResendClient(): Resend | null {
    const key = process.env.RESEND_API_KEY
    if (!key) return null
    if (!client) client = new Resend(key)
    return client
}
