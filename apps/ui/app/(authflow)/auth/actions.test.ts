import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verifyCaptcha: vi.fn(), ensureEmailAccount: vi.fn(), claimEmailCodeAsk: vi.fn(), lookupEmailForSignUp: vi.fn(), getUser: vi.fn(), provisionUser: vi.fn(), cookies: new Map<string, string>() }))

vi.mock('next/headers', () => ({
    headers: async () => new Headers({ 'x-real-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0' }),
    cookies: async () => ({ has: (name: string) => mocks.cookies.has(name), get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name) } : undefined) }),
}))
vi.mock('@/lib/auth/captcha', () => ({ verifyCaptcha: mocks.verifyCaptcha }))
vi.mock('@rerun/cloud/billing', () => ({ drawPriceArm: () => '29' }))
vi.mock('@/app/api/_services/email-sign-up.service', () => ({ ensureEmailAccount: mocks.ensureEmailAccount, claimEmailCodeAsk: mocks.claimEmailCodeAsk, lookupEmailForSignUp: mocks.lookupEmailForSignUp }))
vi.mock('@/app/api/_services/sign-in-code.service', () => ({ resendSignInCodeIfLive: vi.fn() }))
vi.mock('@/app/api/_services/user-provisioning.service', () => ({ provisionUser: mocks.provisionUser }))
vi.mock('@/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const { completeSignupAction, prepareAnonymousEmailStep, prepareEmailSignIn } = await import('./actions')

const account = { id: 'user-1', is_anonymous: false }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookies.clear()
    mocks.verifyCaptcha.mockResolvedValue(true)
    mocks.ensureEmailAccount.mockResolvedValue({ ok: true, created: true })
    mocks.claimEmailCodeAsk.mockResolvedValue(true)
    mocks.lookupEmailForSignUp.mockResolvedValue({ ok: true, exists: false })
    mocks.getUser.mockResolvedValue({ data: { user: account } })
    mocks.provisionUser.mockResolvedValue({ signedUp: true })
})

describe('completeSignupAction', () => {
    it('stamps the signup of the account behind the request, with the phone step a web signup owes', async () => {
        expect(await completeSignupAction()).toEqual({ ok: true, signedUp: true })

        expect(mocks.provisionUser).toHaveBeenCalledWith(expect.objectContaining({ auth: expect.anything() }), account, { phoneStep: true, priceArm: '29', locale: 'en' })
    })

    it('asks no phone of whoever arrived by invite', async () => {
        mocks.cookies.set('pending_invite', '/invite/abc')

        await completeSignupAction()

        expect(mocks.provisionUser).toHaveBeenCalledWith(expect.anything(), account, expect.objectContaining({ phoneStep: false }))
    })

    it('does nothing for a visitor still anonymous, nor for nobody', async () => {
        mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'visitor', is_anonymous: true } } })
        expect(await completeSignupAction()).toEqual({ ok: false })

        mocks.getUser.mockResolvedValueOnce({ data: { user: null } })
        expect(await completeSignupAction()).toEqual({ ok: false })

        expect(mocks.provisionUser).not.toHaveBeenCalled()
    })

    it('says so when the provisioning could not go through', async () => {
        mocks.provisionUser.mockResolvedValueOnce(null)

        expect(await completeSignupAction()).toEqual({ ok: false })
    })
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

describe('prepareAnonymousEmailStep', () => {
    it('says whether a normalized address has an account, once the robot check and the pace let the caller through', async () => {
        mocks.lookupEmailForSignUp.mockResolvedValue({ ok: true, exists: true })

        expect(await prepareAnonymousEmailStep({ email: '  Ada@Example.com ', captcha: { provider: 'turnstile', token: 'token' } })).toEqual({ ok: true, exists: true })

        expect(mocks.verifyCaptcha).toHaveBeenCalledWith({ provider: 'turnstile', token: 'token' }, '203.0.113.7')
        expect(mocks.claimEmailCodeAsk).toHaveBeenCalledWith('203.0.113.7')
        expect(mocks.lookupEmailForSignUp).toHaveBeenCalledWith('ada@example.com')
    })

    it('tells a visitor the robot check turned away nothing about the address', async () => {
        mocks.verifyCaptcha.mockResolvedValue(false)

        expect(await prepareAnonymousEmailStep({ email: 'ada@example.com' })).toMatchObject({ ok: false, reason: 'captcha_failed' })
        expect(mocks.lookupEmailForSignUp).not.toHaveBeenCalled()
    })

    it('holds back a network that asked for too many codes', async () => {
        mocks.claimEmailCodeAsk.mockResolvedValue(false)

        expect(await prepareAnonymousEmailStep({ email: 'ada@example.com', captcha: { provider: 'turnstile', token: 'token' } })).toMatchObject({ ok: false, reason: 'too_many_codes' })
        expect(mocks.lookupEmailForSignUp).not.toHaveBeenCalled()
    })

    it('refuses a blocked domain the anonymous flow used to let through', async () => {
        mocks.lookupEmailForSignUp.mockResolvedValue({ ok: false, error: 'blocked_domain' })

        expect(await prepareAnonymousEmailStep({ email: 'someone@blocked.example', captcha: { provider: 'turnstile', token: 'token' } })).toEqual({ ok: false, reason: 'blocked_domain', error: 'This email domain is not accepted. Use another address.', code: 'emailDomainBlocked' })
    })

    it('refuses what is not an email', async () => {
        expect(await prepareAnonymousEmailStep({ email: 'nope', captcha: { provider: 'turnstile', token: 'token' } })).toMatchObject({ ok: false, reason: 'invalid_email' })
        expect(mocks.verifyCaptcha).not.toHaveBeenCalled()
    })
})
