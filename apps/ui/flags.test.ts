import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSessionIdentity: vi.fn() }))

vi.mock('flags/next', () => ({ dedupe: <T>(fn: T) => fn, flag: <T>(definition: T) => definition }))
vi.mock('@/supabase/session/getServerSession', () => ({ getSessionIdentity: mocks.getSessionIdentity }))

const { identify, releasedOrEarlyAccess } = await import('./flags')

describe('identify', () => {
    beforeEach(() => mocks.getSessionIdentity.mockReset())

    it("reads the email of the caller's token, in lower case", async () => {
        mocks.getSessionIdentity.mockResolvedValue({ id: 'u1', email: 'Me@Acme.Test' })
        expect(await identify()).toEqual({ user: { email: 'me@acme.test' } })
    })

    it('identifies nobody without a session or without an email', async () => {
        mocks.getSessionIdentity.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'anon', email: undefined })
        expect(await identify()).toEqual({ user: undefined })
        expect(await identify()).toEqual({ user: undefined })
    })
})

describe('releasedOrEarlyAccess', () => {
    it('opens to an early access domain, and to everyone once released', () => {
        expect(releasedOrEarlyAccess(false, ['acme.test'])({ entities: { user: { email: 'me@acme.test' } } })).toBe(true)
        expect(releasedOrEarlyAccess(false, ['acme.test'])({ entities: { user: { email: 'me@other.test' } } })).toBe(false)
        expect(releasedOrEarlyAccess(true)({ entities: undefined })).toBe(true)
    })
})
