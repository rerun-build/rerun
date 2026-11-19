import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isReferralCode } from '@/ee/services/referral-attach.service'

import { GET } from './route'

vi.mock('@rerun/cloud/billing', () => ({ BILLING_ENABLED: true }))
vi.mock('@/ee/services/referral-attach.service', () => ({ isReferralCode: vi.fn() }))

function visit(code: string) {
    return GET(new NextRequest(`https://app.rerun.build/i/${code}`), { params: Promise.resolve({ code }) })
}

beforeEach(() => vi.resetAllMocks())

describe('GET /i/[code]', () => {
    it('keeps a known code in a cookie and sends the visitor to the sign-in', async () => {
        vi.mocked(isReferralCode).mockResolvedValue(true)

        const response = await visit('Clement')

        expect(isReferralCode).toHaveBeenCalledWith('clement')
        expect(response.headers.get('location')).toBe('https://app.rerun.build/auth')
        const cookie = response.headers.get('set-cookie') ?? ''
        expect(cookie).toContain('rerun_referral=clement')
        expect(cookie.toLowerCase()).toContain('httponly')
    })

    it('sends the visitor to the public origin behind the proxy, with a secure cookie', async () => {
        vi.mocked(isReferralCode).mockResolvedValue(true)
        const request = new NextRequest('http://0.0.0.0:3000/i/clement', { headers: { 'x-forwarded-host': 'app.rerun.build', 'x-forwarded-proto': 'https' } })

        const response = await GET(request, { params: Promise.resolve({ code: 'clement' }) })

        expect(response.headers.get('location')).toBe('https://app.rerun.build/auth')
        expect((response.headers.get('set-cookie') ?? '').toLowerCase()).toContain('secure')
    })

    it('treats an unknown code as a plain visit, without a cookie', async () => {
        vi.mocked(isReferralCode).mockResolvedValue(false)

        const response = await visit('nobody')

        expect(response.headers.get('location')).toBe('https://app.rerun.build/')
        expect(response.headers.get('set-cookie')).toBeNull()
    })
})
