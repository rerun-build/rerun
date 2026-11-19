import { beforeEach, describe, expect, it, vi } from 'vitest'

const resendSignInCodeIfLive = vi.fn()
const ensureEmailAccount = vi.fn()
const claimEmailCodeAsk = vi.fn()
vi.mock('@/app/api/_services/sign-in-code.service', () => ({ resendSignInCodeIfLive: (...args: unknown[]) => resendSignInCodeIfLive(...args) }))
vi.mock('@/app/api/_services/email-sign-up.service', () => ({ ensureEmailAccount: (...args: unknown[]) => ensureEmailAccount(...args), claimEmailCodeAsk: (...args: unknown[]) => claimEmailCodeAsk(...args) }))
vi.mock('@/supabase/server', () => ({ createClient: async () => ({}), getRequestAccessToken: async () => null }))

const { POST } = await import('./route')

const segment = { params: Promise.resolve({}) }

function ask(email: string, client = 'ios/1.0.2 (38)') {
    return POST(new Request('https://app.rerun.build/api/v1/auth/email/code', { method: 'POST', body: JSON.stringify({ email }), headers: { 'x-forwarded-for': '203.0.113.7', 'x-rerun-client': client } }), segment)
}

describe('POST /api/v1/auth/email/code', () => {
    beforeEach(() => {
        resendSignInCodeIfLive.mockReset()
        ensureEmailAccount.mockReset()
        resendSignInCodeIfLive.mockResolvedValue(null)
        ensureEmailAccount.mockResolvedValue({ ok: true, created: true })
        claimEmailCodeAsk.mockReset().mockResolvedValue(true)
    })

    it('mails the code still good again instead of letting Supabase void it', async () => {
        resendSignInCodeIfLive.mockResolvedValue('sent')
        expect(await (await ask('Ada@Example.com ')).json()).toEqual({ mailed: true })
        expect(resendSignInCodeIfLive).toHaveBeenCalledWith('ada@example.com', null)
        expect(ensureEmailAccount).not.toHaveBeenCalled()
    })

    it('opens the account of a new address, then leaves the code to Supabase, without saying the address was new', async () => {
        expect(await (await ask('ada@example.com')).json()).toEqual({ mailed: false })
        expect(ensureEmailAccount).toHaveBeenCalledWith('ada@example.com', '203.0.113.7')
        ensureEmailAccount.mockResolvedValue({ ok: true, created: false })
        expect(await (await ask('ada@example.com')).json()).toEqual({ mailed: false })
    })

    it('tells iOS 18 to 21 no account was created, the field they need to read the answer', async () => {
        expect(await (await ask('ada@example.com', 'ios/1.0.0 (21)')).json()).toEqual({ mailed: false, created: false })
        resendSignInCodeIfLive.mockResolvedValue('sent')
        expect(await (await ask('ada@example.com', 'ios/1.0.0 (18)')).json()).toEqual({ mailed: true, created: false })
    })

    it('answers an address it cannot read with the reason the app shows in its language', async () => {
        const res = await ask('ada at example')
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ reason: 'invalid_email' })
        expect(ensureEmailAccount).not.toHaveBeenCalled()
    })

    it('counts every ask against the caller, before reading anything about the address', async () => {
        claimEmailCodeAsk.mockResolvedValue(false)
        const res = await ask('ada@example.com')
        expect(res.status).toBe(429)
        expect(claimEmailCodeAsk).toHaveBeenCalledWith('203.0.113.7')
        expect(resendSignInCodeIfLive).not.toHaveBeenCalled()
        expect(ensureEmailAccount).not.toHaveBeenCalled()
    })

    it('refuses a blocked domain with the message the web shows', async () => {
        ensureEmailAccount.mockResolvedValue({ ok: false, error: 'blocked_domain' })
        const res = await ask('ada@spam.example')
        expect(res.status).toBe(422)
        expect(await res.json()).toEqual({ reason: 'blocked_domain', error: 'This email domain is not accepted. Use another address.' })
    })

    it('answers 400 on something that is not an address', async () => {
        expect((await ask('not an email')).status).toBe(400)
    })
})
