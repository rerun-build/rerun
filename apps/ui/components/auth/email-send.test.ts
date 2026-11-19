import { describe, expect, it, vi } from 'vitest'

vi.mock('@moldwright/analytics/client', () => ({ track: vi.fn() }))

const { isSlowSend } = await import('./email-send')

describe('isSlowSend', () => {
    it('reads a Supabase request that ran out of time as slow, whatever names it', () => {
        expect(isSlowSend({ status: 504, code: 'request_timeout', message: 'context deadline exceeded' })).toBe(true)
        expect(isSlowSend({ status: 504 })).toBe(true)
        expect(isSlowSend({ code: 'request_timeout' })).toBe(true)
    })

    it('leaves every other failure to be shown as an error', () => {
        expect(isSlowSend({ status: 422, code: 'signup_disabled' })).toBe(false)
        expect(isSlowSend(new Error('Network down'))).toBe(false)
        expect(isSlowSend('504')).toBe(false)
        expect(isSlowSend(null)).toBe(false)
    })
})
