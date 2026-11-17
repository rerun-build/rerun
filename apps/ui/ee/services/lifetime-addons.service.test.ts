import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, writeMethodOf } from '@/test/supabase-fake'
import { applyLifetimeAddonsSubscription } from './lifetime-addons.service'

const m = vi.hoisted(() => ({ createServiceRoleClient: vi.fn(), findWorkspaceId: vi.fn(), syncWorkspaceAppSlots: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: m.createServiceRoleClient }))
vi.mock('./billing.service', () => ({ findWorkspaceId: m.findWorkspaceId }))
vi.mock('@/lib/apps/slots-sync', () => ({ syncWorkspaceAppSlots: m.syncWorkspaceAppSlots }))

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
