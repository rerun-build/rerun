import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, writeMethodOf } from '@/test/supabase-fake'
import { stripe } from '@/ee/lib/billing/stripe'
import { applyLifetimeAddonsSubscription, createLifetimeAddonsCheckout, removeLifetimeAddonSlot, settleLifetimeAddonsCheckout } from './lifetime-addons.service'

const m = vi.hoisted(() => ({ createServiceRoleClient: vi.fn(), findWorkspaceId: vi.fn(), syncWorkspaceAppSlots: vi.fn(), ensureStripeCustomer: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: m.createServiceRoleClient }))
vi.mock('./billing.service', () => ({ findWorkspaceId: m.findWorkspaceId, ensureStripeCustomer: m.ensureStripeCustomer, PLAN_PAYMENT_METHOD_TYPES: ['card', 'link'] }))
vi.mock('@/lib/apps/slots-sync', () => ({ syncWorkspaceAppSlots: m.syncWorkspaceAppSlots }))
vi.mock('@/lib/app-origin', () => ({ getAppOrigin: async () => 'https://app.rerun.test' }))
vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()),
    stripe: (await import('@/ee/test/stripe-fake')).fakeStripe(),
}))

const WORKSPACE_ID = 7
const PERIOD_END = 1_800_000_000
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString()

function subscription(fields: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
    return {
        id: 'sub_addons',
        object: 'subscription',
        status: 'active',
        customer: 'cus_1',
        metadata: { kind: 'lifetime_addons', workspace_id: String(WORKSPACE_ID) },
        items: {
            data: [
                { price: { id: 'price_linkedin_slot' }, quantity: 2, current_period_end: PERIOD_END },
                { price: { id: 'price_whatsapp_slot' }, quantity: 1, current_period_end: PERIOD_END },
            ],
        },
        ...fields,
    } as unknown as Stripe.Subscription
}

function useDb(row: { stripe_addons_subscription_id: string | null; addons_current_period_end: string | null } | null) {
    const fake = fakeSupabase((table, calls) => (table === 'workspaces' && !writeMethodOf(calls) ? { data: row } : undefined))
    m.createServiceRoleClient.mockReturnValue(fake.client)
    return { ...fake, updates: () => fake.writes('workspaces').map(write => write.payload) }
}

beforeEach(() => {
    vi.resetAllMocks()
    m.findWorkspaceId.mockResolvedValue(WORKSPACE_ID)
    m.ensureStripeCustomer.mockResolvedValue({ workspaceId: WORKSPACE_ID, customerId: 'cus_1' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('applyLifetimeAddonsSubscription', () => {
    it('adopts a purchased subscription and opens its slots, touching nothing of the plan', async () => {
        const db = useDb({ stripe_addons_subscription_id: null, addons_current_period_end: null })
        await applyLifetimeAddonsSubscription(subscription(), { adopt: true })
        expect(db.updates()).toEqual([{ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO }])
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 2, whatsapp_slot: 1 }, { periodAdvanced: true })
    })

    it('holds a slot given back mid-period until the renewal', async () => {
        const db = useDb({ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        await applyLifetimeAddonsSubscription(subscription(), { adopt: false })
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 2, whatsapp_slot: 1 }, { periodAdvanced: false })
    })

    it('keeps the slots of a renewal Stripe is still retrying', async () => {
        const db = useDb({ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        await applyLifetimeAddonsSubscription(subscription({ status: 'past_due' }), { adopt: false })
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 2, whatsapp_slot: 1 }, { periodAdvanced: false })
    })

    it('gives every slot back at once when the subscription is over', async () => {
        const db = useDb({ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        await applyLifetimeAddonsSubscription(subscription({ status: 'canceled' }), { adopt: false })
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 0, whatsapp_slot: 0 }, { periodAdvanced: true })
    })

    it('ignores the lifecycle events of a subscription the workspace does not hold', async () => {
        const db = useDb({ stripe_addons_subscription_id: 'sub_other', addons_current_period_end: null })
        await applyLifetimeAddonsSubscription(subscription({ status: 'canceled' }), { adopt: false })
        expect(db.updates()).toEqual([])
        expect(m.syncWorkspaceAppSlots).not.toHaveBeenCalled()
    })

    it('does nothing for a subscription that resolves to no workspace', async () => {
        m.findWorkspaceId.mockResolvedValue(null)
        const db = useDb(null)
        await applyLifetimeAddonsSubscription(subscription(), { adopt: true })
        expect(db.calls).toEqual([])
    })
})

describe('createLifetimeAddonsCheckout', () => {
    it('sells one monthly slot, tagged so the webhook keeps it off the plan', async () => {
        vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' } as never)

        await expect(createLifetimeAddonsCheckout('linkedin', 'linkedin_slot', 'req-1', { trial: true })).resolves.toBe('https://checkout.stripe.test/cs_1')
        const [params, options] = vi.mocked(stripe.checkout.sessions.create).mock.calls[0]
        expect(params).toMatchObject({
            mode: 'subscription',
            customer: 'cus_1',
            line_items: [{ price: 'price_linkedin_slot', quantity: 1 }],
            metadata: { kind: 'lifetime_addons', workspace_id: '7' },
            subscription_data: { metadata: { kind: 'lifetime_addons', workspace_id: '7' }, trial_period_days: 5 },
            success_url: 'https://app.rerun.test/?app=linkedin&slots_session={CHECKOUT_SESSION_ID}',
            cancel_url: 'https://app.rerun.test/?app=linkedin',
        })
        expect(options).toEqual({ idempotencyKey: 'lifetime-addons-req-1' })
    })

    it('bills from day one once the trial has been used', async () => {
        vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' } as never)

        await createLifetimeAddonsCheckout('whatsapp', 'whatsapp_slot', 'req-1', { trial: false })
        const [params] = vi.mocked(stripe.checkout.sessions.create).mock.calls[0]
        expect(params?.subscription_data).toEqual({ metadata: { kind: 'lifetime_addons', workspace_id: '7' } })
    })
})

describe('removeLifetimeAddonSlot', () => {
    function withSlots(linkedin: number, whatsapp: number): Stripe.Subscription {
        const items = [
            ...(linkedin ? [{ id: 'si_li', price: { id: 'price_linkedin_slot' }, quantity: linkedin }] : []),
            ...(whatsapp ? [{ id: 'si_wa', price: { id: 'price_whatsapp_slot' }, quantity: whatsapp }] : []),
        ]
        return { id: 'sub_addons', items: { data: items } } as unknown as Stripe.Subscription
    }

    it('lowers the quantity from the next renewal, refunding nothing', async () => {
        await removeLifetimeAddonSlot(withSlots(2, 0), 'linkedin_slot')
        expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_addons', { items: [{ id: 'si_li', quantity: 1 }], proration_behavior: 'none' })
    })

    it('drops the item of an app whose last slot is given back while another app keeps its own', async () => {
        await removeLifetimeAddonSlot(withSlots(1, 1), 'linkedin_slot')
        expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_addons', { items: [{ id: 'si_li', deleted: true }], proration_behavior: 'none' })
    })

    it('ends the subscription with its period when the very last slot is given back', async () => {
        await removeLifetimeAddonSlot(withSlots(1, 0), 'linkedin_slot')
        expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_addons', { cancel_at_period_end: true })
    })
})

describe('settleLifetimeAddonsCheckout', () => {
    it('applies the subscription of a completed session of this workspace', async () => {
        const db = useDb({ stripe_addons_subscription_id: null, addons_current_period_end: null })
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ id: 'cs_1', status: 'complete', customer: 'cus_1', subscription: 'sub_addons', metadata: { kind: 'lifetime_addons' } } as never)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscription() as never)

        await settleLifetimeAddonsCheckout('cs_1')
        expect(db.updates()).toEqual([{ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO }])
    })

    it('ignores a session of another customer', async () => {
        const db = useDb({ stripe_addons_subscription_id: null, addons_current_period_end: null })
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ id: 'cs_1', status: 'complete', customer: 'cus_other', subscription: 'sub_addons', metadata: { kind: 'lifetime_addons' } } as never)

        await settleLifetimeAddonsCheckout('cs_1')
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
        expect(db.updates()).toEqual([])
    })
})
