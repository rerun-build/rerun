import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordStorePurchase = vi.fn()
const mergeForeman = vi.fn()
const context = { userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7, subscription_status: null as string | null }, role: 'admin', supabase: {} }

vi.mock('@/ee/services/store-billing.service', async () => {
    class InvalidStorePurchaseError extends Error {}
    return { InvalidStorePurchaseError, recordStorePurchase: (...args: unknown[]) => recordStorePurchase(...args) }
})
vi.mock('@/lib/foreman/profile', () => ({ mergeForeman: (...args: unknown[]) => mergeForeman(...args) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireAdminContext: async () => context,
}))

const { InvalidStorePurchaseError } = await import('@/ee/services/store-billing.service')
const { POST } = await import('./route')

const segment = { params: Promise.resolve({}) }
const request = (body: unknown, client = 'ios/1.2.0 (60)') => new Request('https://app.rerun.build/api/v1/billing/store/purchases', { method: 'POST', body: JSON.stringify(body), headers: { 'x-rerun-client': client } })

describe('POST /api/v1/billing/store/purchases', () => {
    beforeEach(() => {
        context.workspace.subscription_status = null
        recordStorePurchase.mockReset().mockResolvedValue({ ok: true, entitled: true, status: 'trialing' })
        mergeForeman.mockReset().mockResolvedValue({})
    })

    it('marks where the trial started, for the trial test to leave it out', async () => {
        await POST(request({ store: 'google', purchaseToken: 't', productId: 'rerun.base.monthly' }, 'android/1.0.2 (5)'), segment)
        expect(mergeForeman).toHaveBeenCalledWith(context, { trialStartedIn: 'android' })
    })

    it('marks nothing for a workspace already on, a restore or a paid start', async () => {
        context.workspace.subscription_status = 'trialing'
        await POST(request({ store: 'apple', jws: 'a.b.c', restore: true }), segment)
        context.workspace.subscription_status = null
        recordStorePurchase.mockResolvedValue({ ok: true, entitled: true, status: 'active' })
        await POST(request({ store: 'apple', jws: 'a.b.c' }), segment)
        expect(mergeForeman).not.toHaveBeenCalled()
    })

    it('records an App Store transaction for the caller workspace', async () => {
        const res = await POST(request({ store: 'apple', jws: 'a.b.c' }), segment)
        expect(await res.json()).toEqual({ ok: true, entitled: true, status: 'trialing' })
        expect(recordStorePurchase).toHaveBeenCalledWith(context, { store: 'apple', jws: 'a.b.c' })
    })

    it('records a Google Play purchase token with its product', async () => {
        await POST(request({ store: 'google', purchaseToken: 'token-1', productId: 'rerun.base.monthly' }), segment)
        expect(recordStorePurchase).toHaveBeenCalledWith(context, { store: 'google', purchaseToken: 'token-1', productId: 'rerun.base.monthly' })
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
