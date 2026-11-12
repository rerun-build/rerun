import type { StoreOffer, StorePurchaseResult } from '@rerun/contracts'
import { act, renderHook, waitFor } from '@testing-library/react-native'

import { ApiError } from '@/api/client'

import type { StoreProduct, StoreTransaction, StorefrontEvents, Storefront } from './types'
import { usePaywall } from './usePaywall'

const mockFetchStoreOffer = jest.fn<Promise<StoreOffer>, []>()
const mockPostStorePurchase = jest.fn<Promise<StorePurchaseResult>, [unknown, unknown]>()
const mockRefreshMe = jest.fn(async () => {})
const mockTrack = jest.fn()

jest.mock('expo-iap', () => ({}))
jest.mock('@/api/billing', () => ({ fetchStoreOffer: () => mockFetchStoreOffer(), postStorePurchase: (caller: unknown, request: unknown) => mockPostStorePurchase(caller, request) }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } }, refreshMe: mockRefreshMe }) }))
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }))
jest.mock('./index', () => ({ storefront: {} }))

const OFFER: StoreOffer = { available: true, provider: 'apple', productId: 'rerun.base.monthly', accountToken: '7d7c1c5e-8b8b-4b5e-9d47-0f9a4b0c2a11', trialEligible: true }
const PRODUCT: StoreProduct = { productId: 'rerun.base.monthly', displayPrice: '$29.99', trialDays: 7, offerToken: null }

// A store that reports what the test tells it to, the way expo-iap's listeners do.
function fakeStore(product: StoreProduct | null = PRODUCT) {
    let events: StorefrontEvents | null = null
    const finish = jest.fn(async () => {})
    const store: Storefront & { emit: (transaction?: Partial<StoreTransaction>) => void; events: () => StorefrontEvents; finish: jest.Mock } = {
        provider: 'apple',
        connect: jest.fn(async (handlers: StorefrontEvents) => {
            events = handlers
            return () => (events = null)
        }),
        product: jest.fn(async () => product),
        buy: jest.fn(async () => {}),
        restore: jest.fn(async () => []),
        manage: jest.fn(async () => {}),
        emit: transaction => events?.onTransaction({ productId: 'rerun.base.monthly', request: { store: 'apple', jws: 'signed' }, finish, ...transaction }),
        events: () => events!,
        finish,
    }
    return store
}

async function mounted(store: Storefront, onEntitled = jest.fn()) {
    const hook = await renderHook(() => usePaywall({ surface: 'onboarding', storefront: store, onEntitled }))
    await waitFor(() => expect(hook.result.current.state.step).not.toBe('loading'))
    return hook
}

describe('usePaywall', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockFetchStoreOffer.mockResolvedValue(OFFER)
        mockPostStorePurchase.mockResolvedValue({ ok: true, entitled: true, status: 'trialing' })
    })

    it('shows the store price and the free week once the hub sells', async () => {
        const store = fakeStore()
        const { result } = await mounted(store)
        expect(result.current.state).toEqual({ step: 'ready', product: PRODUCT, notice: null })
        expect(store.product).toHaveBeenCalledWith('rerun.base.monthly', { trialEligible: true })
        expect(mockTrack).toHaveBeenCalledWith('paywall_viewed', { trigger: 'onboarding', variant: 'apple' })
    })

    it('buys with the account token, sends the transaction to the hub, then finishes it and says the workspace is on', async () => {
        const store = fakeStore()
        const onEntitled = jest.fn()
        const { result } = await mounted(store, onEntitled)

        await act(async () => result.current.buy())
        expect(store.buy).toHaveBeenCalledWith(PRODUCT, OFFER.accountToken)
        expect(result.current.state.step).toBe('buying')

        await act(async () => store.emit())
        expect(mockPostStorePurchase).toHaveBeenCalledWith({ accessToken: 't', workspaceId: 7 }, { store: 'apple', jws: 'signed' })
        expect(store.finish).toHaveBeenCalled()
        expect(mockRefreshMe).toHaveBeenCalled()
        expect(result.current.state).toEqual({ step: 'entitled' })
        expect(onEntitled).toHaveBeenCalledTimes(1)
        expect(mockTrack).toHaveBeenCalledWith('purchase_started', { store: 'apple', surface: 'onboarding', trial: true })
    })

    it('goes back to the offer, quietly, when the sheet is closed', async () => {
        const store = fakeStore()
        const { result } = await mounted(store)
        await act(async () => result.current.buy())
        await act(async () => store.events().onCancelled())
        expect(result.current.state).toEqual({ step: 'ready', product: PRODUCT, notice: 'cancelled' })
        expect(mockTrack).toHaveBeenCalledWith('purchase_cancelled', { store: 'apple', surface: 'onboarding' })
    })

    it('says a payment is pending, and grants nothing yet', async () => {
        const store = fakeStore()
        const { result } = await mounted(store)
        await act(async () => store.events().onPending())
        expect(result.current.state).toMatchObject({ step: 'ready', notice: 'pending' })
        expect(mockPostStorePurchase).not.toHaveBeenCalled()
    })

    it('keeps a transaction the hub could not take, unfinished, and sends it again on Try again', async () => {
        const store = fakeStore()
        const { result } = await mounted(store)
        mockPostStorePurchase.mockRejectedValueOnce(new ApiError(500, 'Internal error'))
        await act(async () => store.emit())
        expect(result.current.state).toMatchObject({ step: 'ready', notice: 'failed' })
        expect(store.finish).not.toHaveBeenCalled()

        await act(async () => result.current.retry())
        expect(mockPostStorePurchase).toHaveBeenCalledTimes(2)
        expect(store.finish).toHaveBeenCalled()
        expect(result.current.state).toEqual({ step: 'entitled' })
    })

    it('finishes a subscription that runs another workspace and says so', async () => {
        const store = fakeStore()
        const onEntitled = jest.fn()
        const { result } = await mounted(store, onEntitled)
        mockPostStorePurchase.mockResolvedValueOnce({ ok: false, reason: 'linked_elsewhere' })
        await act(async () => store.emit())
        expect(store.finish).toHaveBeenCalled()
        expect(result.current.state).toMatchObject({ step: 'ready', notice: 'linked_elsewhere' })
        expect(onEntitled).not.toHaveBeenCalled()
    })

    it('restores the latest purchase of the account, or says there is none', async () => {
        const store = fakeStore()
        const { result } = await mounted(store)
        await act(async () => result.current.restore())
        expect(result.current.state).toMatchObject({ step: 'ready', notice: 'nothing_to_restore' })

        const finish = jest.fn(async () => {})
        ;(store.restore as jest.Mock).mockResolvedValueOnce([{ productId: 'rerun.base.monthly', request: { store: 'apple', jws: 'old' }, finish }])
        await act(async () => result.current.restore())
        expect(mockPostStorePurchase).toHaveBeenLastCalledWith(expect.anything(), { store: 'apple', jws: 'old', restore: true })
        expect(result.current.state).toEqual({ step: 'entitled' })
    })

    it('ignores a transaction for another product', async () => {
        const store = fakeStore()
        await mounted(store)
        await act(async () => store.emit({ productId: 'something.else' }))
        expect(mockPostStorePurchase).not.toHaveBeenCalled()
    })

    it.each(['not_sold', 'member', 'subscribed'] as const)('sells nothing when the hub says %s, and never asks the store', async reason => {
        mockFetchStoreOffer.mockResolvedValue({ available: false, reason })
        const store = fakeStore()
        const { result } = await mounted(store)
        expect(result.current.state).toEqual({ step: 'unavailable', reason })
        expect(store.connect).not.toHaveBeenCalled()
    })

    it('says the store has nothing to sell when the product is missing, and reloads on Try again', async () => {
        const store = fakeStore(null)
        const { result } = await mounted(store)
        expect(result.current.state).toEqual({ step: 'unavailable', reason: 'no_product' })
        ;(store.product as jest.Mock).mockResolvedValueOnce(PRODUCT)
        await act(async () => result.current.retry())
        await waitFor(() => expect(result.current.state.step).toBe('ready'))
        expect(mockFetchStoreOffer).toHaveBeenCalledTimes(2)
    })

    it('reads nothing while disabled', async () => {
        const store = fakeStore()
        const { result } = await renderHook(() => usePaywall({ surface: 'no_plan', enabled: false, storefront: store }))
        expect(result.current.state.step).toBe('loading')
        expect(mockFetchStoreOffer).not.toHaveBeenCalled()
    })
})
