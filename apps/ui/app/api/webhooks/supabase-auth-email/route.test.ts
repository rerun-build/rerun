import { randomUUID } from 'node:crypto'
import { Webhook } from 'standardwebhooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendSignInCodeEmail = vi.fn()
vi.mock('@/app/api/_services/email.service', () => ({ sendSignInCodeEmail: (input: unknown) => sendSignInCodeEmail(input) }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({}) }))
const recipientLocale = vi.fn()
vi.mock('@/lib/i18n/recipient-locale', () => ({ recipientLocale: (...args: unknown[]) => recipientLocale(...args) }))

const claimAuthEmailSend = vi.fn()
vi.mock('@/app/api/_services/email-sign-up.service', () => ({ claimAuthEmailSend: (email: string) => claimAuthEmailSend(email) }))

const rememberSignInCode = vi.fn()
vi.mock('@/app/api/_services/sign-in-code.service', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_services/sign-in-code.service')>()),
    rememberSignInCode: (input: unknown) => rememberSignInCode(input),
}))

const SECRET = 'v1,whsec_' + Buffer.from('a-local-test-secret-of-32-bytes!').toString('base64')

async function post(body: object, secret = SECRET) {
    const { POST } = await import('./route')
    const payload = JSON.stringify(body)
    const id = randomUUID()
    const timestamp = new Date()
    const signature = new Webhook(secret.replace('v1,whsec_', '')).sign(id, timestamp, payload)
    return POST(
        new Request('http://localhost/api/webhooks/supabase-auth-email', {
            method: 'POST',
            body: payload,
            headers: { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'webhook-signature': signature },
        })
    )
}

const emailData = (overrides: object) => ({ token: '', token_hash: '', token_new: '', token_hash_new: '', email_action_type: 'magiclink', ...overrides })

describe('supabase send email hook', () => {
    beforeEach(() => {
        vi.stubEnv('SEND_EMAIL_HOOK_SECRET', SECRET)
        sendSignInCodeEmail.mockReset().mockResolvedValue({ ok: true, id: 'email_1' })
        recipientLocale.mockReset().mockResolvedValue('en')
        rememberSignInCode.mockReset()
        claimAuthEmailSend.mockReset().mockResolvedValue(true)
    })

    it('mails the code and a confirm link for a sign-in', async () => {
        const res = await post({ user: { id: 'user-1', email: 'a@b.co' }, email_data: emailData({ token: '123456', token_hash: 'hash1' }) })

        expect(res.status).toBe(200)
        expect(sendSignInCodeEmail).toHaveBeenCalledOnce()
        const input = sendSignInCodeEmail.mock.calls[0][0]
        expect(input).toMatchObject({ to: 'a@b.co', code: '123456' })
        expect(input.signInUrl).toContain('/auth/confirm?token_hash=hash1&type=magiclink')
    })

    it('remembers the code it mailed, so asking again can send the same one', async () => {
        await post({ user: { id: 'user-1', email: 'a@b.co' }, email_data: emailData({ token: '123456', token_hash: 'hash1' }) })

        expect(rememberSignInCode).toHaveBeenCalledWith({ email: 'a@b.co', userId: 'user-1', type: 'magiclink', code: '123456', tokenHash: 'hash1' })
    })

    it('mails only the new address when an anonymous user claims an email', async () => {
        await post({ user: { email: '', new_email: 'new@b.co' }, email_data: emailData({ email_action_type: 'email_change', token: '654321', token_hash: 'hashNew' }) })

        expect(sendSignInCodeEmail).toHaveBeenCalledOnce()
        const input = sendSignInCodeEmail.mock.calls[0][0]
        expect(input).toMatchObject({ to: 'new@b.co', code: '654321' })
        expect(input.signInUrl).toContain('token_hash=hashNew&type=email_change')
    })

    it('pairs the swapped hashes when both addresses must confirm a change', async () => {
        await post({
            user: { email: 'old@b.co', new_email: 'new@b.co' },
            email_data: emailData({ email_action_type: 'email_change', token: '111111', token_hash_new: 'hashCurrent', token_new: '222222', token_hash: 'hashNew' }),
        })

        const [current, next] = sendSignInCodeEmail.mock.calls.map(([input]) => input)
        expect(current).toMatchObject({ to: 'old@b.co', code: '111111' })
        expect(next).toMatchObject({ to: 'new@b.co', code: '222222' })
        expect(rememberSignInCode.mock.calls.map(([input]) => input.tokenHash)).toEqual(['hashCurrent', 'hashNew'])
    })

    it('mails the code alone to an account that moves to a new address, which is already signed in', async () => {
        await post({ user: { id: 'user-1', email: 'old@b.co', new_email: 'new@b.co' }, email_data: emailData({ email_action_type: 'email_change', token: '654321', token_hash: 'hashNew' }) })

        expect(sendSignInCodeEmail).toHaveBeenCalledOnce()
        expect(sendSignInCodeEmail.mock.calls[0][0]).toMatchObject({ to: 'new@b.co', code: '654321', signInUrl: undefined })
    })

    it('counts every email under its normalized address, before anything is sent', async () => {
        await post({ user: { id: 'user-1', email: 'Ada@B.co' }, email_data: emailData({ token: '123456', token_hash: 'hash1' }) })

        expect(claimAuthEmailSend).toHaveBeenCalledWith('ada@b.co')
    })

    it('refuses to mail an address that was mailed too often, whoever asked Supabase for the code', async () => {
        claimAuthEmailSend.mockResolvedValue(false)

        const res = await post({ user: { id: 'user-1', email: 'a@b.co' }, email_data: emailData({ token: '123456', token_hash: 'hash1' }) })

        expect(res.status).toBe(429)
        expect(sendSignInCodeEmail).not.toHaveBeenCalled()
        expect(rememberSignInCode).not.toHaveBeenCalled()
    })

    it('rejects a payload signed with another secret', async () => {
        const res = await post({ user: { email: 'a@b.co' }, email_data: emailData({ token: '1' }) }, 'v1,whsec_' + Buffer.from('another-secret-of-thirty-two-byt').toString('base64'))

        expect(res.status).toBe(401)
        expect(sendSignInCodeEmail).not.toHaveBeenCalled()
    })

    it('fails the hook when Resend refuses, so Supabase reports the error to the form', async () => {
        sendSignInCodeEmail.mockResolvedValue({ ok: false, error: 'boom' })

        const res = await post({ user: { email: 'a@b.co' }, email_data: emailData({ token: '123456', token_hash: 'hash1' }) })

        expect(res.status).toBe(502)
        expect(rememberSignInCode).not.toHaveBeenCalled()
    })
})
