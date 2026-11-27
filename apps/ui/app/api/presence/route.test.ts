import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getClaims: vi.fn(),
    getUser: vi.fn(),
    touchPresence: vi.fn(),
    touchSandboxActivity: vi.fn(),
    clearPresence: vi.fn(),
}))

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ auth: { getClaims: mocks.getClaims, getUser: mocks.getUser } }),
    getRequestAccessToken: async () => null,
    getRequestWorkspaceId: async () => null,
}))
vi.mock('@/app/api/_services/presence.service', () => ({
    touchPresence: mocks.touchPresence,
    touchSandboxActivity: mocks.touchSandboxActivity,
    clearPresence: mocks.clearPresence,
}))

const { DELETE, POST } = await import('./route')
const { forgetStamps } = await import('@/lib/server/stamp-memory')

const claimsOf = (claims: Record<string, unknown> | null) => ({ data: claims ? { claims } : null, error: null })

describe('/api/presence', () => {
    beforeEach(() => {
        for (const mock of Object.values(mocks)) mock.mockReset()
        forgetStamps()
    })

    it('stamps a signed-in tab from its token, without asking the auth server', async () => {
        mocks.getClaims.mockResolvedValue(claimsOf({ sub: 'u1', email: 'me@acme.test', is_anonymous: false }))
        const res = await POST()
        expect(res.status).toBe(204)
        expect(mocks.touchPresence).toHaveBeenCalledWith('u1')
        expect(mocks.touchSandboxActivity).toHaveBeenCalledWith('u1')
        expect(mocks.getUser).not.toHaveBeenCalled()
    })

    it('clears the presence of a closing tab', async () => {
        mocks.getClaims.mockResolvedValue(claimsOf({ sub: 'u1', is_anonymous: false }))
        expect((await DELETE()).status).toBe(204)
        expect(mocks.clearPresence).toHaveBeenCalledWith('u1')
    })

    it('writes nothing for an anonymous visitor', async () => {
        mocks.getClaims.mockResolvedValue(claimsOf({ sub: 'anon', is_anonymous: true }))
        expect((await POST()).status).toBe(204)
        expect((await DELETE()).status).toBe(204)
        expect(mocks.touchPresence).not.toHaveBeenCalled()
        expect(mocks.clearPresence).not.toHaveBeenCalled()
    })

    it('writes nothing without a token, nor with one that does not verify', async () => {
        mocks.getClaims.mockResolvedValueOnce(claimsOf(null)).mockRejectedValueOnce(new Error('invalid JWT'))
        expect((await POST()).status).toBe(204)
        expect((await POST()).status).toBe(204)
        expect(mocks.touchPresence).not.toHaveBeenCalled()
        expect(mocks.getUser).not.toHaveBeenCalled()
    })

    it('touches the presence on every beat, the sandbox activity once an hour', async () => {
        vi.useFakeTimers()
        mocks.getClaims.mockResolvedValue(claimsOf({ sub: 'u1', is_anonymous: false }))
        await POST()
        vi.advanceTimersByTime(30_000)
        await POST()
        expect(mocks.touchPresence).toHaveBeenCalledTimes(2)
        expect(mocks.touchSandboxActivity).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(60 * 60_000)
        await POST()
        expect(mocks.touchSandboxActivity).toHaveBeenCalledTimes(2)
        vi.useRealTimers()
    })
})
