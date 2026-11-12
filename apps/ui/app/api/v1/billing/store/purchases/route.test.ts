import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordStorePurchase = vi.fn()
const context = { userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, role: 'admin', supabase: {} }

vi.mock('@/ee/services/store-billing.service', async () => {
    class InvalidStorePurchaseError extends Error {}
    return { InvalidStorePurchaseError, recordStorePurchase: (...args: unknown[]) => recordStorePurchase(...args) }
})
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireAdminContext: async () => context,
}))

const { InvalidStorePurchaseError } = await import('@/ee/services/store-billing.service')
const { POST } = await import('./route')

const segment = { params: Promise.resolve({}) }
const request = (body: unknown) => new Request('https://app.rerun.build/api/v1/billing/store/purchases', { method: 'POST', body: JSON.stringify(body) })

describe('POST /api/v1/billing/store/purchases', () => {
    beforeEach(() => {
        recordStorePurchase.mockReset().mockResolvedValue({ ok: true, entitled: true, status: 'trialing' })
    })

    it('records an App Store transaction for the caller workspace', async () => {
        const res = await POST(request({ store: 'apple', jws: 'a.b.c' }), segment)
        expect(await res.json()).toEqual({ ok: true, entitled: true, status: 'trialing' })
        expect(recordStorePurchase).toHaveBeenCalledWith(context, { store: 'apple', jws: 'a.b.c' })
    })

    it('answers a refusal the app explains as a 200 with its reason', async () => {
        recordStorePurchase.mockResolvedValue({ ok: false, reason: 'linked_elsewhere' })
        const res = await POST(request({ store: 'apple', jws: 'a.b.c', restore: true }), segment)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: false, reason: 'linked_elsewhere' })
    })

    it('answers 400 to a transaction that does not verify', async () => {
        recordStorePurchase.mockRejectedValue(new InvalidStorePurchaseError('Apple transaction did not verify'))
        expect((await POST(request({ store: 'apple', jws: 'a.b.c' }), segment)).status).toBe(400)
    })

    it('answers 400 to a body of neither store', async () => {
        expect((await POST(request({ store: 'amazon', token: 'x' }), segment)).status).toBe(400)
        expect((await POST(request({ store: 'google', purchaseToken: 'x' }), segment)).status).toBe(400)
        expect(recordStorePurchase).not.toHaveBeenCalled()
    })

    it('answers 500 to anything else, which the app retries with the same transaction', async () => {
        recordStorePurchase.mockRejectedValue(new Error('database down'))
        expect((await POST(request({ store: 'apple', jws: 'a.b.c' }), segment)).status).toBe(500)
    })
})
