import nodemailer from 'nodemailer'
import { Resend } from 'resend'

import { DEFAULT_SENDERS } from '@rerun/cloud/senders'
import { APP_URL } from '@/lib/app-url'

export { APP_URL, notificationUrl } from '@/lib/app-url'

export const TRANSACTIONAL_FROM = process.env.RESEND_FROM || process.env.SMTP_FROM || DEFAULT_SENDERS.transactional
export const EXPERTS_FROM = process.env.RESEND_EXPERTS_FROM || process.env.SMTP_FROM || DEFAULT_SENDERS.experts
export const MARKETING_FROM = process.env.RESEND_MARKETING_FROM || process.env.SMTP_FROM || DEFAULT_SENDERS.marketing
export const NEWSLETTER_FROM = process.env.RESEND_NEWSLETTER_FROM ?? MARKETING_FROM
export const REPLY_TO = process.env.RESEND_REPLY_TO ?? DEFAULT_SENDERS.replyTo

export type SendEmailResult = { ok: true; id: string | null; skipped?: boolean } | { ok: false; error: string }

export function redirectDelivery(to: string, subject: string): { to: string; subject: string } {
    const inbox = process.env.EMAIL_REDIRECT_TO
    if (!inbox) return { to, subject }
    return { to: inbox, subject: `[staging → ${to}] ${subject}` }
}

export const IS_PRODUCTION_MAILER = process.env.NODE_ENV === 'production' && !process.env.EMAIL_REDIRECT_TO

type SendPayload = Parameters<Resend['emails']['send']>[0]
type SendResponse = Awaited<ReturnType<Resend['emails']['send']>>
export type Mailer = { emails: { send(payload: SendPayload): Promise<SendResponse> } }

let client: Mailer | null = null

export function getResendClient(): Mailer | null {
    if (process.env.SMTP_HOST) return (client ??= smtpMailer())
    const key = process.env.RESEND_API_KEY
    if (!key) return null
    if (!client) client = new Resend(key)
    return client
}

function smtpMailer(): Mailer {
    const port = Number(process.env.SMTP_PORT || 465)
    const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
    return {
        emails: {
            async send(payload) {
                const { from, to, cc, bcc, replyTo, subject, html, text, headers } = payload as Extract<SendPayload, { html: string }>
                try {
                    const info = await transport.sendMail({ from, to, cc, bcc, replyTo, subject, html, text, headers })
                    return { data: { id: info.messageId }, error: null } as SendResponse
                } catch (err) {
                    return { data: null, error: { name: 'application_error', message: err instanceof Error ? err.message : String(err) } } as SendResponse
                }
            },
        },
    }
}
