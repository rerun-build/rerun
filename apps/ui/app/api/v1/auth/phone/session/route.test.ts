import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const completePhoneSignIn = vi.fn()
const completeAppReviewSignIn = vi.fn()
const countVerifyAttempt = vi.fn()
vi.mock('@rerun/cloud/app-review', () => ({
    isAppReviewNumber: (phone: string) => !!process.env.APP_REVIEW_PHONE && phone === process.env.APP_REVIEW_PHONE,
    isAppReviewSignIn: (phone: string, code: string) => !!process.env.APP_REVIEW_PHONE && phone === process.env.APP_REVIEW_PHONE && !!process.env.APP_REVIEW_CODE && code === process.env.APP_REVIEW_CODE,
}))
vi.mock('@/app/api/_services/phone-sign-in.service', () => ({
    completePhoneSignIn: (...args: unknown[]) => completePhoneSignIn(...args),
    completeAppReviewSignIn: (...args: unknown[]) => completeAppReviewSignIn(...args),
    countVerifyAttempt: (...args: unknown[]) => countVerifyAttempt(...args),
    VERIFY_WINDOW_MS: 900_000,
}))
const sessionless = { auth: {} }
vi.mock('@/supabase/server', () => ({ createClient: async () => ({}), getRequestAccessToken: async () => null, createSessionlessClient: () => sessionless }))

const { POST } = await import('./route')

const segment = { params: Promise.resolve({}) }
const SIGNED_IN = { ok: true, created: true, session: { accessToken: 'access', refreshToken: 'refresh' } }

function verify(code: string) {
    return POST(new Request('https://app.rerun.build/api/v1/auth/phone/session', { method: 'POST', headers: { 'x-real-ip': '203.0.113.9' }, body: JSON.stringify({ phone: '0612345678', country: 'FR', channel: 'sms', code }) }), segment)
}

describe('POST /api/v1/auth/phone/session', () => {
    beforeEach(() => {
        completePhoneSignIn.mockReset()
        completeAppReviewSignIn.mockReset()
        completePhoneSignIn.mockResolvedValue(SIGNED_IN)
        completeAppReviewSignIn.mockResolvedValue(SIGNED_IN)
        countVerifyAttempt.mockReset().mockResolvedValue('ok')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('hands the session to the app, opened on a client that keeps no cookie', async () => {
        const res = await verify('123456')
        expect(await res.json()).toEqual({ created: true, session: { accessToken: 'access', refreshToken: 'refresh' } })
        expect(completePhoneSignIn).toHaveBeenCalledWith(sessionless, '+33612345678', '123456', 'sms')
    })

    it('opens nothing on a wrong code', async () => {
        completePhoneSignIn.mockResolvedValue({ ok: false, error: 'wrong_code' })
        const res = await verify('000001')
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ reason: 'wrong_code', error: 'This code is wrong or has expired.' })
    })

    it('lets App Review in with its fixed code, and only with it', async () => {
        vi.stubEnv('APP_REVIEW_PHONE', '+33612345678')
        vi.stubEnv('APP_REVIEW_CODE', '482913')

        await verify('482913')
        expect(completeAppReviewSignIn).toHaveBeenCalledWith(sessionless, '+33612345678')
        expect(completePhoneSignIn).not.toHaveBeenCalled()

        await verify('482914')
        expect(completePhoneSignIn).toHaveBeenCalledTimes(1)
    })

    it('counts every try before looking at the code, and shuts the door once the window is full', async () => {
        vi.stubEnv('APP_REVIEW_PHONE', '+33612345678')
        vi.stubEnv('APP_REVIEW_CODE', '482913')
        countVerifyAttempt.mockResolvedValue('too_many')

        const res = await verify('482913')

        expect(countVerifyAttempt).toHaveBeenCalledWith('+33612345678', '203.0.113.9')
        expect(res.status).toBe(429)
        expect(await res.json()).toMatchObject({ reason: 'too_many', retryAfterSeconds: 900 })
        expect(completeAppReviewSignIn).not.toHaveBeenCalled()
        expect(completePhoneSignIn).not.toHaveBeenCalled()
    })

    it('opens nothing when the tries cannot be counted', async () => {
        countVerifyAttempt.mockResolvedValue('unavailable')
        expect((await verify('123456')).status).toBe(503)
        expect(completePhoneSignIn).not.toHaveBeenCalled()
    })

    it('keeps the review door shut while its code is unset', async () => {
        vi.stubEnv('APP_REVIEW_PHONE', '+33612345678')
        await verify('')
        expect(completeAppReviewSignIn).not.toHaveBeenCalled()
    })
})
