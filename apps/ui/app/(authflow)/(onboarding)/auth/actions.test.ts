import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verifyCaptcha: vi.fn(), ensureEmailAccount: vi.fn(), claimEmailCodeAsk: vi.fn(), getUser: vi.fn() }))

vi.mock('next/headers', () => ({
    headers: async () => new Headers({ 'x-real-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0' }),
}))
vi.mock('@/lib/auth/captcha', () => ({ verifyCaptcha: mocks.verifyCaptcha }))
vi.mock('@/app/api/_services/email-sign-up.service', () => ({ ensureEmailAccount: mocks.ensureEmailAccount, claimEmailCodeAsk: mocks.claimEmailCodeAsk }))
vi.mock('@/app/api/_services/sign-in-code.service', () => ({ resendSignInCodeIfLive: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const { prepareEmailSignIn } = await import('./actions')

beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyCaptcha.mockResolvedValue(true)
    mocks.ensureEmailAccount.mockResolvedValue({ ok: true, created: true })
    mocks.claimEmailCodeAsk.mockResolvedValue(true)
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
})

describe('prepareEmailSignIn', () => {
    it('opens the account of a normalized address, for the caller behind the edge', async () => {
        expect(await prepareEmailSignIn({ email: '  Ada@Example.com ', captcha: { provider: 'turnstile', token: 'token' } })).toEqual({ ok: true, created: true })

        expect(mocks.verifyCaptcha).toHaveBeenCalledWith({ provider: 'turnstile', token: 'token' }, '203.0.113.7')
        expect(mocks.ensureEmailAccount).toHaveBeenCalledWith('ada@example.com', '203.0.113.7')
    })

    it('refuses a visitor the robot check turned away, before anything is created', async () => {
        mocks.verifyCaptcha.mockResolvedValue(false)

        expect(await prepareEmailSignIn({ email: 'ada@example.com' })).toEqual({ ok: false, reason: 'captcha_failed', error: 'We could not confirm you are not a robot. Try again.', code: 'captchaFailed' })
        expect(mocks.ensureEmailAccount).not.toHaveBeenCalled()
    })

    it('refuses what is not an email', async () => {
        expect(await prepareEmailSignIn({ email: 'not-an-email', captcha: { provider: 'turnstile', token: 'token' } })).toMatchObject({ ok: false, reason: 'invalid_email' })
        expect(mocks.verifyCaptcha).not.toHaveBeenCalled()
    })

    it('says a blocked domain is not accepted, in the words the hook uses', async () => {
        mocks.ensureEmailAccount.mockResolvedValue({ ok: false, error: 'blocked_domain' })

        expect(await prepareEmailSignIn({ email: 'someone@blocked.example', captcha: { provider: 'turnstile', token: 'token' } })).toEqual({ ok: false, reason: 'blocked_domain', error: 'This email domain is not accepted. Use another address.', code: 'emailDomainBlocked' })
    })

    it('passes a held-back caller on', async () => {
        mocks.ensureEmailAccount.mockResolvedValue({ ok: false, error: 'too_many' })

        expect(await prepareEmailSignIn({ email: 'ada@example.com', captcha: { provider: 'turnstile', token: 'token' } })).toMatchObject({ ok: false, reason: 'too_many' })
    })

    it('holds back a network that asked for too many codes, before any account is opened', async () => {
        mocks.claimEmailCodeAsk.mockResolvedValue(false)

        expect(await prepareEmailSignIn({ email: 'ada@example.com', captcha: { provider: 'turnstile', token: 'token' } })).toEqual({ ok: false, reason: 'too_many_codes', error: 'Too many codes were asked from your network. Try again later.', code: 'tooManyCodesFromNetwork' })
        expect(mocks.claimEmailCodeAsk).toHaveBeenCalledWith('203.0.113.7')
        expect(mocks.ensureEmailAccount).not.toHaveBeenCalled()
    })
})
