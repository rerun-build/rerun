import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportAffiliateSignup } from '@rerun/contracts'
import { affiliateReferralMetadata } from './affiliate'

const cookieJar = new Map<string, string>()

vi.mock('next/headers', () => ({
    cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined) }),
}))

describe('affiliateReferralMetadata', () => {
    beforeEach(() => cookieJar.clear())

    it('carries the referral of a visitor an affiliate sent', async () => {
        cookieJar.set('affonso_referral', 'clk_123')
        expect(await affiliateReferralMetadata()).toEqual({ affonso_referral: 'clk_123' })
    })

    it('stays empty for a visitor nobody referred', async () => {
        expect(await affiliateReferralMetadata()).toEqual({})
    })

    it('drops a referral cookie that was emptied', async () => {
        cookieJar.set('affonso_referral', '')
        expect(await affiliateReferralMetadata()).toEqual({})
    })
})

describe('reportAffiliateSignup', () => {
    const signup = { email: 'buyer@example.com', externalUserId: 'user_1' }

    function stubBrowser(consentCookie: string) {
        const pixel = { signup: vi.fn() }
        vi.stubGlobal('document', { cookie: consentCookie })
        vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) })
        return pixel
    }

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('reports through a pixel that is already there', () => {
        const pixel = stubBrowser('rerun-consent=v1:granted:1')
        window.Affonso = pixel
        reportAffiliateSignup(signup)
        expect(pixel.signup).toHaveBeenCalledWith(signup)
    })

    it('waits for a pixel that has not loaded yet', () => {
        const pixel = stubBrowser('rerun-consent=v1:granted:1')
        reportAffiliateSignup(signup)
        expect(pixel.signup).not.toHaveBeenCalled()

        window.Affonso = pixel
        vi.advanceTimersByTime(1000)
        expect(pixel.signup).toHaveBeenCalledWith(signup)
    })

    it('stops retrying instead of polling for the rest of the session', () => {
        const pixel = stubBrowser('rerun-consent=v1:granted:1')
        reportAffiliateSignup(signup)
        vi.advanceTimersByTime(60_000)

        window.Affonso = pixel
        vi.advanceTimersByTime(60_000)
        expect(pixel.signup).not.toHaveBeenCalled()
    })

    it('reports nothing for a visitor who refused cookies', () => {
        const pixel = stubBrowser('rerun-consent=v1:denied:1')
        window.Affonso = pixel
        reportAffiliateSignup(signup)
        vi.advanceTimersByTime(60_000)
        expect(pixel.signup).not.toHaveBeenCalled()
    })
})
