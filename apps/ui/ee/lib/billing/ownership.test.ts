import { describe, expect, it } from 'vitest'
import { isSameSubscription, isStoreBilled, shouldAdoptSubscription } from './ownership'

describe('isSameSubscription', () => {
    it('recognises the subscription the workspace is billed on', () => {
        expect(isSameSubscription('sub_current', 'sub_current')).toBe(true)
    })

    it('rejects another subscription sitting on the same customer', () => {
        expect(isSameSubscription('sub_current', 'sub_orphan')).toBe(false)
    })

    it('lets anything through when the workspace has no subscription yet', () => {
        expect(isSameSubscription(null, 'sub_new')).toBe(true)
        expect(isSameSubscription(undefined, 'sub_new')).toBe(true)
    })
})

describe('shouldAdoptSubscription', () => {
    it('keeps a live subscription from being replaced by an orphan', () => {
        expect(shouldAdoptSubscription({ id: 'sub_current', status: 'active' }, 'sub_orphan')).toBe(false)
        expect(shouldAdoptSubscription({ id: 'sub_current', status: 'past_due' }, 'sub_orphan')).toBe(false)
        expect(shouldAdoptSubscription({ id: 'sub_current', status: 'trialing' }, 'sub_orphan')).toBe(false)
    })

    it('adopts a new subscription once the stored one is over', () => {
        expect(shouldAdoptSubscription({ id: 'sub_old', status: 'canceled' }, 'sub_new')).toBe(true)
        expect(shouldAdoptSubscription({ id: 'sub_old', status: 'incomplete_expired' }, 'sub_new')).toBe(true)
    })

    it('adopts when the workspace has no subscription', () => {
        expect(shouldAdoptSubscription({ id: null, status: null }, 'sub_new')).toBe(true)
    })

    it('always adopts the subscription the workspace already holds', () => {
        expect(shouldAdoptSubscription({ id: 'sub_current', status: 'active' }, 'sub_current')).toBe(true)
    })
})

describe('isStoreBilled', () => {
    it('protects a workspace a store subscription runs', () => {
        expect(isStoreBilled({ billing_provider: 'apple', subscription_status: 'trialing' })).toBe(true)
        expect(isStoreBilled({ billing_provider: 'google', subscription_status: 'past_due' })).toBe(true)
    })

    it('lets Stripe have a workspace whose store subscription is over, or that Stripe bills', () => {
        expect(isStoreBilled({ billing_provider: 'apple', subscription_status: 'canceled' })).toBe(false)
        expect(isStoreBilled({ billing_provider: 'stripe', subscription_status: 'active' })).toBe(false)
        expect(isStoreBilled({ billing_provider: null, subscription_status: 'active' })).toBe(false)
        expect(isStoreBilled(null)).toBe(false)
    })
})
