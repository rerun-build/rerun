import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startPhoneSignIn = vi.fn()
vi.mock('@/app/api/_services/phone-sign-in.service', () => ({ startPhoneSignIn: (...args: unknown[]) => startPhoneSignIn(...args) }))
vi.mock('@/supabase/server', () => ({ createClient: async () => ({}), getRequestAccessToken: async () => null }))

// The App Review door is Rerun Cloud's (@rerun/cloud/app-review); what is tested is how the route treats
// the number it names, so the door is pinned here whatever the build resolves it to.
vi.mock('@rerun/cloud/app-review', () => ({
    isAppReviewNumber: (phone: string) => !!process.env.APP_REVIEW_PHONE && phone === process.env.APP_REVIEW_PHONE,
    isAppReviewSignIn: (phone: string, code: string) => !!process.env.APP_REVIEW_PHONE && phone === process.env.APP_REVIEW_PHONE && !!process.env.APP_REVIEW_CODE && code === process.env.APP_REVIEW_CODE,
}))

const { POST } = await import('./route')

const segment = { params: Promise.resolve({}) }

function ask(body: object, client?: string) {
    const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.7', 'accept-language': 'fr-FR', ...(client ? { 'x-rerun-client': client } : {}) }
    return POST(new Request('https://app.rerun.build/api/v1/auth/phone/code', { method: 'POST', body: JSON.stringify(body), headers }), segment)
}

describe('POST /api/v1/auth/phone/code', () => {
    beforeEach(() => {
        startPhoneSignIn.mockReset()
        startPhoneSignIn.mockResolvedValue({ ok: true, channel: 'sms' })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('sends a code without a signed-in caller, counted in the window of the app', async () => {
        const res = await ask({ phone: '06 12 34 56 78', country: 'FR', channel: 'sms' })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ channel: 'sms' })
        expect(startPhoneSignIn).toHaveBeenCalledWith('+33612345678', 'sms', '203.0.113.7', 'fr-FR', null, 'ios')
    })

    it.each([
        ['ios/1.4.0 (41)', 'ios'],
        ['android/1.0.0 (3)', 'android'],
        ['curl/8', 'ios'],
    ])('counts a code asked by %s in the window of %s', async (client, app) => {
        expect((await ask({ phone: '0612345678', country: 'FR', channel: 'sms' }, client)).status).toBe(200)
        expect(startPhoneSignIn).toHaveBeenCalledWith('+33612345678', 'sms', '203.0.113.7', 'fr-FR', null, app)
    })

    it('turns a number that is not one away before anything is sent', async () => {
        const res = await ask({ phone: '12', country: 'FR', channel: 'sms' })
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ reason: 'invalid_number', error: 'Enter a valid mobile number.' })
        expect(startPhoneSignIn).not.toHaveBeenCalled()
    })

    it('says how long to wait when a code is already on its way', async () => {
        startPhoneSignIn.mockResolvedValue({ ok: false, error: 'too_soon', retryAfterSeconds: 42 })
        const res = await ask({ phone: '0612345678', country: 'FR', channel: 'sms' })
        expect(res.status).toBe(429)
        expect(await res.json()).toMatchObject({ reason: 'too_soon', retryAfterSeconds: 42 })
    })

    it('sends nothing to the number given to App Review', async () => {
        vi.stubEnv('APP_REVIEW_PHONE', '+33612345678')
        const res = await ask({ phone: '0612345678', country: 'FR', channel: 'whatsapp' })
        expect(await res.json()).toEqual({ channel: 'whatsapp' })
        expect(startPhoneSignIn).not.toHaveBeenCalled()
    })
})
