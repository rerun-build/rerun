import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { isTellaAutoCapture } = await import('./tella-auto-capture')

const carrying = (value: string) => new Headers({ 'x-tella-auto-capture': value })

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('isTellaAutoCapture', () => {
    it('recognizes the secret of the Tella workspace', () => {
        vi.stubEnv('TELLA_AUTO_CAPTURE_SECRET', 'tella-secret')

        expect(isTellaAutoCapture(carrying('tella-secret'))).toBe(true)
    })

    it('refuses a wrong value, whatever its length', () => {
        vi.stubEnv('TELLA_AUTO_CAPTURE_SECRET', 'tella-secret')

        expect(isTellaAutoCapture(carrying('tella-secreT'))).toBe(false)
        expect(isTellaAutoCapture(carrying('tella'))).toBe(false)
        expect(isTellaAutoCapture(carrying('tella-secret-and-more'))).toBe(false)
    })

    it('refuses a request without the header', () => {
        vi.stubEnv('TELLA_AUTO_CAPTURE_SECRET', 'tella-secret')

        expect(isTellaAutoCapture(new Headers())).toBe(false)
    })

    it('recognizes nobody when no secret is set', () => {
        vi.stubEnv('TELLA_AUTO_CAPTURE_SECRET', '')

        expect(isTellaAutoCapture(carrying(''))).toBe(false)
        expect(isTellaAutoCapture(carrying('anything'))).toBe(false)
    })
})
