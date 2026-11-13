import { describe, expect, it } from 'vitest'
import { canEndTrialNow, isApiEntitled, isMachineEntitled, isPaidSubscription, isSubscriptionEntitled, isTrialLapsed, isWorkspaceApiEntitled } from './entitlement'

describe('isSubscriptionEntitled', () => {
    it('keeps a trial and a late payment entitled', () => {
        expect(isSubscriptionEntitled('active')).toBe(true)
        expect(isSubscriptionEntitled('trialing')).toBe(true)
        expect(isSubscriptionEntitled('past_due')).toBe(true)
    })

    it('refuses a subscription that is over or missing', () => {
        for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', null, undefined]) expect(isSubscriptionEntitled(status)).toBe(false)
    })
})

describe('isMachineEntitled', () => {
    it('keeps the machine of a running plan and of a trial', () => {
        expect(isMachineEntitled('active')).toBe(true)
        expect(isMachineEntitled('trialing')).toBe(true)
    })

    it('takes it back on the first declined charge, and from anything that is over', () => {
        for (const status of ['past_due', 'canceled', 'unpaid', 'incomplete', 'paused', null, undefined]) expect(isMachineEntitled(status)).toBe(false)
    })
})

describe('isPaidSubscription', () => {
    it('counts an active or past_due subscription as paid', () => {
        expect(isPaidSubscription('active')).toBe(true)
        expect(isPaidSubscription('past_due')).toBe(true)
    })

    it('refuses a trial, a cancellation and no status', () => {
        expect(isPaidSubscription('trialing')).toBe(false)
        expect(isPaidSubscription('canceled')).toBe(false)
        expect(isPaidSubscription(null)).toBe(false)
    })
})

describe('isApiEntitled', () => {
    it('opens the API to any live subscription, trial included', () => {
        expect(isApiEntitled('active')).toBe(true)
        expect(isApiEntitled('past_due')).toBe(true)
        expect(isApiEntitled('trialing')).toBe(true)
        expect(isApiEntitled('canceled')).toBe(false)
        expect(isApiEntitled(null)).toBe(false)
    })
})

describe('isWorkspaceApiEntitled', () => {
    it('opens the API to a sandbox whatever its status', () => {
        expect(isWorkspaceApiEntitled({ subscription_status: null, is_sandbox: true })).toBe(true)
        expect(isWorkspaceApiEntitled({ subscription_status: 'trialing', is_sandbox: true })).toBe(true)
    })

    it('follows the subscription status for a regular workspace', () => {
        expect(isWorkspaceApiEntitled({ subscription_status: 'past_due', is_sandbox: false })).toBe(true)
        expect(isWorkspaceApiEntitled({ subscription_status: 'trialing', is_sandbox: false })).toBe(true)
        expect(isWorkspaceApiEntitled({ subscription_status: 'canceled', is_sandbox: false })).toBe(false)
        expect(isWorkspaceApiEntitled({ subscription_status: null, is_sandbox: false })).toBe(false)
    })
})

describe('canEndTrialNow', () => {
    it('converts a trial that carries a card', () => {
        expect(canEndTrialNow({ status: 'trialing', hasPaymentMethod: true, cancelAtPeriodEnd: false })).toBe(true)
    })

    it('refuses a trial without a card', () => {
        expect(canEndTrialNow({ status: 'trialing', hasPaymentMethod: false, cancelAtPeriodEnd: false })).toBe(false)
    })

    // Billing a full cycle to a subscription that ends with the period is charging for nothing.
    it('refuses a trial already set to cancel', () => {
        expect(canEndTrialNow({ status: 'trialing', hasPaymentMethod: true, cancelAtPeriodEnd: true })).toBe(false)
    })

    it('has nothing to convert outside a trial', () => {
        expect(canEndTrialNow({ status: 'active', hasPaymentMethod: true, cancelAtPeriodEnd: false })).toBe(false)
        expect(canEndTrialNow({ status: 'past_due', hasPaymentMethod: true, cancelAtPeriodEnd: false })).toBe(false)
        expect(canEndTrialNow({ status: null, hasPaymentMethod: true, cancelAtPeriodEnd: false })).toBe(false)
    })
})

describe('isTrialLapsed', () => {
    it('covers a trial cancelled without a card and a declined first charge', () => {
        expect(isTrialLapsed('canceled', null)).toBe(true)
        expect(isTrialLapsed('past_due', null)).toBe(true)
        expect(isTrialLapsed('unpaid', null)).toBe(true)
    })

    // Stripe attempts the first charge about an hour after the trial ends.
    it('waits while the first charge is still to come', () => {
        expect(isTrialLapsed('trialing', null)).toBe(false)
        expect(isTrialLapsed('active', null)).toBe(false)
    })

    it('never covers an account that has paid once', () => {
        for (const status of ['canceled', 'past_due', 'unpaid', 'active']) expect(isTrialLapsed(status, '2026-09-01T00:00:00Z')).toBe(false)
    })
})
