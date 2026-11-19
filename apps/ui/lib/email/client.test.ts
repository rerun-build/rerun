import { afterEach, describe, expect, it, vi } from 'vitest'
import { notificationUrl, redirectDelivery } from './client'

const sendMail = vi.fn()
const createTransport = vi.fn((_options: unknown) => ({ sendMail }))
vi.mock('nodemailer', () => ({ default: { createTransport: (options: unknown) => createTransport(options) } }))

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('redirectDelivery', () => {
    it('delivers to the real recipient when no redirect inbox is set', () => {
        vi.stubEnv('EMAIL_REDIRECT_TO', '')
        expect(redirectDelivery('user@acme.com', 'Welcome')).toEqual({ to: 'user@acme.com', subject: 'Welcome' })
    })

    it('reroutes every mail to the redirect inbox and names the intended recipient in the subject', () => {
        vi.stubEnv('EMAIL_REDIRECT_TO', 'qa@robagentic.tech')
        expect(redirectDelivery('user@acme.com', 'Welcome')).toEqual({ to: 'qa@robagentic.tech', subject: '[staging → user@acme.com] Welcome' })
    })

    it('reads the variable at send time, not at import', () => {
        vi.stubEnv('EMAIL_REDIRECT_TO', '')
        expect(redirectDelivery('a@b.c', 's').to).toBe('a@b.c')
        vi.stubEnv('EMAIL_REDIRECT_TO', 'qa@robagentic.tech')
        expect(redirectDelivery('a@b.c', 's').to).toBe('qa@robagentic.tech')
    })
})

describe('notificationUrl', () => {
    it('points the board at the notification it opens', () => {
        expect(notificationUrl('3f9e7b94-7f12-81dd')).toMatch(/\/\?notification=3f9e7b94-7f12-81dd$/)
    })
})

describe('IS_PRODUCTION_MAILER', () => {
    it('is off in production as soon as a redirect inbox is set', async () => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('EMAIL_REDIRECT_TO', 'qa@robagentic.tech')
        vi.resetModules()
        expect((await import('./client')).IS_PRODUCTION_MAILER).toBe(false)
        vi.stubEnv('EMAIL_REDIRECT_TO', '')
        vi.resetModules()
        expect((await import('./client')).IS_PRODUCTION_MAILER).toBe(true)
    })
})

describe('getResendClient', () => {
    it('has no client without an API key and reuses the one it built', async () => {
        vi.resetModules()
        vi.stubEnv('RESEND_API_KEY', '')
        const first = await import('./client')
        expect(first.getResendClient()).toBeNull()
        vi.stubEnv('RESEND_API_KEY', 're_test')
        expect(first.getResendClient()).toBe(first.getResendClient())
        expect(first.getResendClient()).not.toBeNull()
    })
})

describe('getResendClient through SMTP', () => {
    const mail = { from: 'Me <me@example.com>', to: 'me@example.com', subject: 'Your code', html: '<p>1</p>', text: '1' }

    async function smtpClient() {
        vi.resetModules()
        vi.stubEnv('SMTP_HOST', 'smtp.example.com')
        vi.stubEnv('SMTP_PORT', '465')
        vi.stubEnv('SMTP_USER', 'me@example.com')
        vi.stubEnv('SMTP_PASS', 'secret')
        vi.stubEnv('RESEND_API_KEY', '')
        return (await import('./client')).getResendClient()!
    }

    it('sends through the mailbox over TLS and answers like Resend', async () => {
        sendMail.mockResolvedValueOnce({ messageId: '<m1@example.com>' })
        const result = await (await smtpClient()).emails.send(mail)

        expect(createTransport).toHaveBeenLastCalledWith({ host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'me@example.com', pass: 'secret' } })
        expect(sendMail).toHaveBeenLastCalledWith(expect.objectContaining(mail))
        expect(result).toEqual({ data: { id: '<m1@example.com>' }, error: null })
    })

    it('hands a refused send back as an error the throttle does not retry', async () => {
        sendMail.mockRejectedValueOnce(new Error('535 authentication failed'))
        const result = await (await smtpClient()).emails.send(mail)

        expect(result).toEqual({ data: null, error: { name: 'application_error', message: '535 authentication failed' } })
    })
})

describe('getResendClient through SMTP', () => {
    const mail = { from: 'Me <me@example.com>', to: 'me@example.com', subject: 'Your code', html: '<p>1</p>', text: '1' }

    async function smtpClient() {
        vi.resetModules()
        vi.stubEnv('SMTP_HOST', 'smtp.example.com')
        vi.stubEnv('SMTP_PORT', '465')
        vi.stubEnv('SMTP_USER', 'me@example.com')
        vi.stubEnv('SMTP_PASS', 'secret')
        vi.stubEnv('RESEND_API_KEY', '')
        return (await import('./client')).getResendClient()!
    }

    it('sends through the mailbox over TLS and answers like Resend', async () => {
        sendMail.mockResolvedValueOnce({ messageId: '<m1@example.com>' })
        const result = await (await smtpClient()).emails.send(mail)

        expect(createTransport).toHaveBeenLastCalledWith({ host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'me@example.com', pass: 'secret' } })
        expect(sendMail).toHaveBeenLastCalledWith(expect.objectContaining(mail))
        expect(result).toEqual({ data: { id: '<m1@example.com>' }, error: null })
    })

    it('hands a refused send back as an error the throttle does not retry', async () => {
        sendMail.mockRejectedValueOnce(new Error('535 authentication failed'))
        const result = await (await smtpClient()).emails.send(mail)

        expect(result).toEqual({ data: null, error: { name: 'application_error', message: '535 authentication failed' } })
    })
})
