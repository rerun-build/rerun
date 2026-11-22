import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const edition = vi.hoisted(() => ({ rerunCloud: true }))
vi.mock('@rerun/cloud/edition', () => ({ get RERUN_CLOUD() { return edition.rerunCloud } }))

const { verifyCaptcha } = await import('./captcha')

const fetchMock = vi.fn()

const answers = (body: object) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))

const turnstile = { provider: 'turnstile', token: 'token' } as const
const hcaptcha = { provider: 'hcaptcha', token: 'puzzle-token' } as const
const caller = new Headers({ 'x-real-ip': '203.0.113.7' })
const tella = (value: string) => new Headers({ 'x-real-ip': '203.0.113.7', 'x-tella-auto-capture': value })

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret')
    vi.stubEnv('HCAPTCHA_SECRET_KEY', 'hsecret')
    vi.stubEnv('NEXT_PUBLIC_HCAPTCHA_SITE_KEY', 'hsite')
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    edition.rerunCloud = true
})

describe('verifyCaptcha', () => {
    it('accepts a token Cloudflare vouches for', async () => {
        answers({ success: true })

        expect(await verifyCaptcha(turnstile, caller)).toBe(true)

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
        expect(JSON.parse(init.body as string)).toEqual({ secret: 'secret', response: 'token', remoteip: '203.0.113.7' })
    })

    it('accepts a solved hCaptcha puzzle', async () => {
        answers({ success: true })

        expect(await verifyCaptcha(hcaptcha, caller)).toBe(true)

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://api.hcaptcha.com/siteverify')
        expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ secret: 'hsecret', response: 'puzzle-token', remoteip: '203.0.113.7', sitekey: 'hsite' })
    })

    it('refuses a token the service rejects', async () => {
        answers({ success: false, 'error-codes': ['invalid-input-response'] })

        expect(await verifyCaptcha(turnstile, caller)).toBe(false)
        expect(await verifyCaptcha(hcaptcha, caller)).toBe(false)
    })

    it('refuses a request that carries no token, without asking anyone', async () => {
        expect(await verifyCaptcha(undefined, caller)).toBe(false)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses when the service cannot be reached', async () => {
        fetchMock.mockRejectedValue(new Error('down'))

        expect(await verifyCaptcha(turnstile, caller)).toBe(false)
    })

    it('refuses a token from a service whose secret is not set', async () => {
        vi.stubEnv('HCAPTCHA_SECRET_KEY', '')
        vi.stubEnv('NODE_ENV', 'development')

        expect(await verifyCaptcha(hcaptcha, caller)).toBe(false)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('lets everyone through on a local stack that has no secret', async () => {
        vi.stubEnv('TURNSTILE_SECRET_KEY', '')
        vi.stubEnv('HCAPTCHA_SECRET_KEY', '')
        vi.stubEnv('NODE_ENV', 'development')

        expect(await verifyCaptcha(undefined, caller)).toBe(true)
    })

    it('lets nobody through in production when every secret is missing', async () => {
        vi.stubEnv('TURNSTILE_SECRET_KEY', '')
        vi.stubEnv('HCAPTCHA_SECRET_KEY', '')
        vi.stubEnv('NODE_ENV', 'production')

        expect(await verifyCaptcha(turnstile, caller)).toBe(false)
    })

    it('lets everyone through on a self-hosted install that set no captcha', async () => {
        vi.stubEnv('TURNSTILE_SECRET_KEY', '')
        vi.stubEnv('HCAPTCHA_SECRET_KEY', '')
        vi.stubEnv('NODE_ENV', 'production')
        edition.rerunCloud = false

        expect(await verifyCaptcha(undefined, caller)).toBe(true)
    })

    it('lets Tella Auto Capture through without a token when it carries the secret', async () => {
        vi.stubEnv('TELLA_AUTO_CAPTURE_SECRET', 'tella-secret')
        vi.spyOn(console, 'info').mockImplementation(() => {})

        expect(await verifyCaptcha(undefined, tella('tella-secret'))).toBe(true)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps the captcha for a Tella header with the wrong secret', async () => {
        vi.stubEnv('TELLA_AUTO_CAPTURE_SECRET', 'tella-secret')

        expect(await verifyCaptcha(undefined, tella('guess'))).toBe(false)
    })

    it('keeps the captcha for a Tella header when no secret is set', async () => {
        vi.stubEnv('TELLA_AUTO_CAPTURE_SECRET', '')

        expect(await verifyCaptcha(undefined, tella(''))).toBe(false)
        expect(await verifyCaptcha(undefined, tella('anything'))).toBe(false)
    })
})
