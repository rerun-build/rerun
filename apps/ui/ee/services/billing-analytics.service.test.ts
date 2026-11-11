import { captureServer, deterministicUuid } from '@rerun/analytics/server'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { reportSubscriptionTransition, reportTrialConverted } from './billing-analytics.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('./billing.service', () => ({ findWorkspaceId: vi.fn() }))
vi.mock('@rerun/analytics/server', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/analytics/server')>()), captureServer: vi.fn() }))

const WORKSPACE_ID = 42
const getUserById = vi.fn()
let owners: { user_id: string }[]

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
    return {
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        currency: 'usd',
        metadata: { plan: 'base' },
        items: { data: [{ price: { id: 'price_base', recurring: { interval: 'month' } }, quantity: 1 }] },
        ...overrides,
    } as unknown as Stripe.Subscription
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    owners = [{ user_id: 'user_1' }]
    const db = fakeSupabase(table => (table === 'workspace_members' ? { data: owners } : undefined))
    vi.mocked(createServiceRoleClient).mockReturnValue(Object.assign(db.client, { auth: { admin: { getUserById } } }))
    getUserById.mockResolvedValue({ data: { user: { email: 'owner@rerun.test' } } })
})

describe('reportSubscriptionTransition', () => {
    it('reports a trial started with a card', async () => {
        await reportSubscriptionTransition(subscription({ status: 'trialing' }), WORKSPACE_ID, null)

        expect(captureServer).toHaveBeenCalledWith(
            'owner@rerun.test',
            'trial_started',
            expect.objectContaining({ workspace_id: WORKSPACE_ID, user_id: 'user_1', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', billing_period: 'monthly', trial_type: 'card_required_5d' }),
            { uuid: deterministicUuid('trial_started:sub_1') },
        )
    })

    it('reports a trial started without a card when a missing payment method cancels it', async () => {
        await reportSubscriptionTransition(subscription({ status: 'trialing', trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } }), WORKSPACE_ID, 'canceled')
        expect(captureServer).toHaveBeenCalledWith('owner@rerun.test', 'trial_started', expect.objectContaining({ trial_type: 'no_card_5d' }), expect.anything())
    })

    it.each([
        ['ios', 'ios'],
        ['android', 'android'],
        ['web', 'web'],
        [undefined, 'web'],
        ['somewhere', 'web'],
    ])('reports a trial started from %s as started from %s', async (origin, reported) => {
        await reportSubscriptionTransition(subscription({ status: 'trialing', metadata: { plan: 'base', ...(origin ? { origin } : {}) } }), WORKSPACE_ID, null)
        expect(captureServer).toHaveBeenCalledWith('owner@rerun.test', 'trial_started', expect.objectContaining({ origin: reported }), expect.anything())
    })

    it('reports the monthly revenue of the arm the subscription was sold on', async () => {
        await reportSubscriptionTransition(subscription({ items: { data: [{ price: { id: 'price_base_29', recurring: { interval: 'month' } }, quantity: 1 }] } }), WORKSPACE_ID, null)
        await reportSubscriptionTransition(subscription({ id: 'sub_2', items: { data: [{ price: { id: 'price_base_29_yearly', recurring: { interval: 'year' } }, quantity: 1 }] } }), WORKSPACE_ID, null)
        await reportSubscriptionTransition(subscription({ id: 'sub_3' }), WORKSPACE_ID, null)

        expect(vi.mocked(captureServer).mock.calls.map(([, , properties]) => (properties as { mrr: number }).mrr)).toEqual([29, 23, 49])
    })

    it('reports a subscription started straight from nothing', async () => {
        await reportSubscriptionTransition(subscription(), WORKSPACE_ID, 'canceled')
        expect(captureServer).toHaveBeenCalledWith('owner@rerun.test', 'subscription_started', expect.not.objectContaining({ trial_type: expect.anything() }), { uuid: deterministicUuid('subscription_started:sub_1') })
    })

    it.each([
        ['trialing', 'active'],
        ['active', 'active'],
        ['past_due', 'active'],
        ['unpaid', 'active'],
        ['trialing', 'trialing'],
        ['active', 'canceled'],
    ])('reports nothing for %s to %s', async (previous, current) => {
        await reportSubscriptionTransition(subscription({ status: current }), WORKSPACE_ID, previous)
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('reports nothing when the workspace has no owner', async () => {
        owners = []
        await reportSubscriptionTransition(subscription(), WORKSPACE_ID, null)
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('swallows a capture failure', async () => {
        vi.mocked(captureServer).mockRejectedValue(new Error('posthog down'))
        await expect(reportSubscriptionTransition(subscription(), WORKSPACE_ID, null)).resolves.toBeUndefined()
    })

    it('swallows an owner lookup failure', async () => {
        getUserById.mockRejectedValue(new Error('auth down'))
        await expect(reportSubscriptionTransition(subscription(), WORKSPACE_ID, null)).resolves.toBeUndefined()
        expect(captureServer).not.toHaveBeenCalled()
    })
})

describe('reportTrialConverted', () => {
    const TRIAL_END = 1_800_000_000

    it('reports the conversion of a subscription that had a trial', async () => {
        await reportTrialConverted(subscription({ trial_end: TRIAL_END }), WORKSPACE_ID)
        expect(captureServer).toHaveBeenCalledWith('owner@rerun.test', 'trial_converted', expect.objectContaining({ workspace_id: WORKSPACE_ID, stripe_subscription_id: 'sub_1' }), {
            uuid: deterministicUuid('trial_converted:sub_1'),
        })
    })

    it('reports nothing for a subscription taken without a trial', async () => {
        await reportTrialConverted(subscription({ trial_end: null }), WORKSPACE_ID)
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('reports nothing when the workspace has no owner', async () => {
        owners = []
        await reportTrialConverted(subscription({ trial_end: TRIAL_END }), WORKSPACE_ID)
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('swallows a capture failure', async () => {
        vi.mocked(captureServer).mockRejectedValue(new Error('posthog down'))
        await expect(reportTrialConverted(subscription({ trial_end: TRIAL_END }), WORKSPACE_ID)).resolves.toBeUndefined()
    })
})
