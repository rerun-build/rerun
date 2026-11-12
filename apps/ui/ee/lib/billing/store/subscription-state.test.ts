import { describe, expect, it } from 'vitest'
import { storeWorkspaceUpdate, type StoreSubscriptionState, type StoreWorkspaceRow } from './subscription-state'

const NOW = new Date('2026-11-12T10:00:00Z')
const TRIAL_END = '2026-11-19T10:00:00.000Z'

const state = (overrides: Partial<StoreSubscriptionState> = {}): StoreSubscriptionState => ({
    provider: 'apple',
    subscriptionId: '2000000001',
    accountToken: 'token',
    environment: 'Sandbox',
    productId: 'rerun.base.monthly',
    status: 'trialing',
    trialStartedAt: NOW.toISOString(),
    trialEndsAt: TRIAL_END,
    periodEnd: TRIAL_END,
    cancelAt: null,
    paid: false,
    revoked: false,
    ...overrides,
})

const row = (overrides: Partial<StoreWorkspaceRow> = {}): StoreWorkspaceRow => ({
    current_period_end: null,
    subscription_status: null,
    first_paid_at: null,
    max_agents: 1,
    max_seats: 1,
    rerun_budget_micros: 3_500_000,
    ...overrides,
})

describe('storeWorkspaceUpdate', () => {
    it('opens a trial with the trial cap and the signup credit held', () => {
        expect(storeWorkspaceUpdate(row(), state(), NOW)).toEqual({
            billing_provider: 'apple',
            store_subscription_id: '2000000001',
            store_environment: 'Sandbox',
            subscription_status: 'trialing',
            subscription_cancel_at: null,
            trial_ends_at: TRIAL_END,
            trial_started_at: NOW.toISOString(),
            current_period_end: TRIAL_END,
            plan: 'base',
            price_arm: '29',
            max_agents: 3,
            max_seats: null,
            model_access: 'best',
            custom_integrations: true,
            rerun_budget_micros: 3_500_000,
            rerun_period_anchor: NOW.toISOString(),
        })
    })

    it('converts with the plan credit, a fresh credit window and the first payment stamped', () => {
        const update = storeWorkspaceUpdate(row({ subscription_status: 'trialing', current_period_end: TRIAL_END, max_agents: 3 }), state({ status: 'active', trialStartedAt: null, trialEndsAt: null, periodEnd: '2026-12-19T10:00:00.000Z', paid: true }), NOW)
        expect(update).toMatchObject({ subscription_status: 'active', max_agents: null, rerun_budget_micros: 5_000_000, rerun_used_micros: 0, first_paid_at: NOW.toISOString() })
        expect(update).not.toHaveProperty('trial_ends_at')
    })

    it('never stamps the first payment twice', () => {
        expect(storeWorkspaceUpdate(row({ first_paid_at: '2026-10-01T00:00:00Z' }), state({ status: 'active', paid: true }), NOW)).not.toHaveProperty('first_paid_at')
    })

    it('holds a limit mid-period and refills nothing when the period has not moved', () => {
        const update = storeWorkspaceUpdate(row({ subscription_status: 'active', current_period_end: TRIAL_END, rerun_budget_micros: 15_000_000 }), state({ status: 'active', trialEndsAt: null, trialStartedAt: null }), NOW)
        expect(update.rerun_budget_micros).toBe(15_000_000)
        expect(update).not.toHaveProperty('rerun_used_micros')
        expect(update).not.toHaveProperty('rerun_period_anchor')
    })

    it('flags a failed renewal once, without touching the plan', () => {
        const first = storeWorkspaceUpdate(row({ subscription_status: 'active' }), state({ status: 'past_due', trialEndsAt: null, trialStartedAt: null }), NOW)
        expect(first).toMatchObject({ subscription_status: 'past_due', payment_failed_at: NOW.toISOString() })
        expect(first).not.toHaveProperty('plan')
        expect(first).not.toHaveProperty('rerun_budget_micros')
        expect(storeWorkspaceUpdate(row({ subscription_status: 'past_due' }), state({ status: 'past_due' }), NOW)).not.toHaveProperty('payment_failed_at')
    })

    it('only ends the right to run on a cancellation', () => {
        const update = storeWorkspaceUpdate(row({ subscription_status: 'active' }), state({ status: 'canceled', trialEndsAt: null, trialStartedAt: null }), NOW)
        expect(update).toEqual({ billing_provider: 'apple', store_subscription_id: '2000000001', store_environment: 'Sandbox', subscription_status: 'canceled', subscription_cancel_at: null })
    })

    it('records when access ends once auto-renewal is off', () => {
        expect(storeWorkspaceUpdate(row(), state({ cancelAt: TRIAL_END }), NOW).subscription_cancel_at).toBe(TRIAL_END)
    })

    it('writes the whole plan on a workspace it has never seen', () => {
        expect(storeWorkspaceUpdate(null, state({ status: 'active', paid: true }), NOW)).toMatchObject({ max_agents: null, first_paid_at: NOW.toISOString() })
    })
})
