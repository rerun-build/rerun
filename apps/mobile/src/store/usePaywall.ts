import type { StoreOfferUnavailableReason, StoreProvider, StorePurchaseRefusal } from '@rerun/contracts'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { fetchStoreOffer, postStorePurchase } from '@/api/billing'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { track } from '@/lib/analytics'

import { storefront as defaultStorefront } from './index'
import type { StoreProduct, StoreTransaction, Storefront } from './types'

// Where the offer is shown, for the analytics.
export type PaywallSurface = 'onboarding' | 'no_plan'

// What the last action left to say under the offer. `cancelled` says nothing: closing the sheet is a
// choice, not a failure.
export type PaywallNotice = 'cancelled' | 'failed' | 'pending' | 'nothing_to_restore' | StorePurchaseRefusal

export type PaywallState =
    | { step: 'loading' }
    // Nothing to sell here: `no_product` when the store has no product to show (not set up, or
    // unreachable), the hub's reason otherwise.
    | { step: 'unavailable'; reason: StoreOfferUnavailableReason | 'no_product' }
    | { step: 'ready' | 'buying' | 'verifying' | 'restoring'; product: StoreProduct; notice: PaywallNotice | null }
    | { step: 'entitled' }

export type Paywall = {
    state: PaywallState
    provider: StoreProvider
    buy: () => void
    restore: () => void
    retry: () => void
}

type Options = { surface: PaywallSurface; enabled?: boolean; onEntitled?: () => void; storefront?: Storefront }

// The plan's offer through the app's store, from the hub's say-so to the hub's confirmation:
//   loading → ready → buying (the store's sheet) → verifying (the hub) → entitled
// A purchase the store reports is sent to the hub before it is finished in the store: until the hub
// has it, StoreKit replays it at every launch and Google keeps it unacknowledged, so nothing paid for
// is ever dropped. A transaction the hub could not take is kept, and Try again sends it once more.
export function usePaywall({ surface, enabled = true, onEntitled, storefront = defaultStorefront }: Options): Paywall {
    const { session, me, refreshMe } = useAuth()
    const workspaceId = me?.workspace.id ?? null
    const signedIn = Boolean(session)
    const [state, setState] = useState<PaywallState>({ step: 'loading' })
    const [attempt, setAttempt] = useState(0)
    const offer = useRef<{ accountToken: string; product: StoreProduct } | null>(null)
    const unsent = useRef<StoreTransaction | null>(null)
    // Once the hub confirms, the offer is never read again: the workspace is on.
    const done = useRef(false)
    const provider = storefront.provider

    const caller = () => (session && workspaceId ? { accessToken: session.access_token, workspaceId } : null)

    const showReady = (notice: PaywallNotice | null) => {
        if (offer.current) setState({ step: 'ready', product: offer.current.product, notice })
    }

    const send = async (transaction: StoreTransaction, restored: boolean) => {
        const who = caller()
        if (!who) return
        unsent.current = transaction
        if (offer.current) setState({ step: 'verifying', product: offer.current.product, notice: null })
        try {
            const result = await postStorePurchase(who, { ...transaction.request, ...(restored ? { restore: true } : {}) })
            // The hub has it, whatever it made of it: the store may close it.
            unsent.current = null
            await transaction.finish().catch(error => console.warn('[store] finishing the transaction failed', error))
            if (restored) track('purchases_restored', { store: provider, surface, outcome: result.ok ? result.status : result.reason })
            if (!result.ok) {
                if (!restored) track('purchase_failed', { store: provider, surface, reason: result.reason })
                showReady(result.reason)
                return
            }
            done.current = true
            await refreshMe().catch(() => {})
            setState({ step: 'entitled' })
            onEntitled?.()
        } catch (error) {
            console.warn('[store] sending the purchase failed', error instanceof ApiError ? `${error.status} ${error.message}` : error)
            track('purchase_failed', { store: provider, surface, reason: error instanceof ApiError ? `hub_${error.status}` : 'network' })
            showReady('failed')
        }
    }

    // The store's events and the offer's caller, read as they are now from inside the effect: a
    // refreshed token or `me` must not reload the offer under a purchase.
    const currentCaller = useEffectEvent(caller)
    const onTransaction = useEffectEvent((transaction: StoreTransaction) => void send(transaction, false))
    const onNotice = useEffectEvent((notice: PaywallNotice, reason?: string) => {
        if (notice === 'cancelled') track('purchase_cancelled', { store: provider, surface })
        if (notice === 'failed') track('purchase_failed', { store: provider, surface, reason: (reason ?? 'store').slice(0, 80) })
        showReady(notice)
    })
    const onViewed = useEffectEvent(() => track('paywall_viewed', { trigger: surface, variant: provider }))

    useEffect(() => {
        const who = currentCaller()
        if (!enabled || !who || done.current) return
        let alive = true
        let disconnect: (() => void) | null = null
        setState({ step: 'loading' })
        ;(async () => {
            try {
                const answer = await fetchStoreOffer(who)
                if (!alive) return
                if (!answer.available) {
                    setState({ step: 'unavailable', reason: answer.reason })
                    return
                }
                const close = await storefront.connect({
                    onTransaction: transaction => {
                        if (transaction.productId === answer.productId) onTransaction(transaction)
                    },
                    onPending: () => onNotice('pending'),
                    onCancelled: () => onNotice('cancelled'),
                    onError: message => onNotice('failed', message),
                })
                if (!alive) return close()
                disconnect = close
                const product = await storefront.product(answer.productId, { trialEligible: answer.trialEligible })
                if (!alive) return
                if (!product) {
                    setState({ step: 'unavailable', reason: 'no_product' })
                    return
                }
                offer.current = { accountToken: answer.accountToken, product }
                onViewed()
                setState(current => (current.step === 'verifying' || current.step === 'entitled' ? current : { step: 'ready', product, notice: null }))
            } catch (error) {
                console.warn('[store] loading the offer failed', error)
                if (alive) setState({ step: 'unavailable', reason: 'no_product' })
            }
        })()
        return () => {
            alive = false
            disconnect?.()
        }
    }, [enabled, signedIn, workspaceId, storefront, attempt])

    const buy = () => {
        const current = offer.current
        if (!current) return
        setState({ step: 'buying', product: current.product, notice: null })
        track('purchase_started', { store: provider, surface, trial: current.product.trialDays !== null })
        storefront.buy(current.product, current.accountToken).catch(error => {
            console.warn('[store] opening the purchase failed', error)
            track('purchase_failed', { store: provider, surface, reason: 'request' })
            showReady('failed')
        })
    }

    const restore = () => {
        const current = offer.current
        if (!current) return
        setState({ step: 'restoring', product: current.product, notice: null })
        storefront
            .restore(current.product.productId)
            .then(transactions => {
                const latest = transactions.at(-1)
                if (latest) return send(latest, true)
                track('purchases_restored', { store: provider, surface, outcome: 'nothing' })
                showReady('nothing_to_restore')
            })
            .catch(error => {
                console.warn('[store] restoring failed', error)
                showReady('failed')
            })
    }

    // A transaction the hub missed goes again as it was; anything else starts over from the offer.
    const retry = () => {
        if (unsent.current) void send(unsent.current, false)
        else setAttempt(count => count + 1)
    }

    return { state, provider, buy, restore, retry }
}
