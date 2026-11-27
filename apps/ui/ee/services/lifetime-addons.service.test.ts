import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, writeMethodOf } from '@/test/supabase-fake'
import { stripe } from '@/ee/lib/billing/stripe'
import { applyLifetimeAddonsSubscription, changeLifetimeMachine, createLifetimeAddonsCheckout, finishPendingLifetimeMachineChange, getLifetimeBillingState, removeLifetimeAddonSlot, resumeLifetimeAddons, settleLifetimeAddonsCheckout } from './lifetime-addons.service'

const m = vi.hoisted(() => ({ createServiceRoleClient: vi.fn(), findWorkspaceId: vi.fn(), syncWorkspaceAppSlots: vi.fn(), ensureStripeCustomer: vi.fn(), readNextInvoice: vi.fn(), updateWithPayment: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: m.createServiceRoleClient }))
vi.mock('./billing.service', () => ({
    findWorkspaceId: m.findWorkspaceId,
    ensureStripeCustomer: m.ensureStripeCustomer,
    readNextInvoice: m.readNextInvoice,
    businessDetailsOf: (customer: { name?: string } | null) => ({ name: customer?.name ?? null, country: null, taxId: null }),
    PLAN_PAYMENT_METHOD_TYPES: ['card', 'link'],
    updateWithPayment: m.updateWithPayment,
}))
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceId: async () => 7 }))
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

function useDb(row: { stripe_addons_subscription_id: string | null; addons_current_period_end: string | null; machine_size?: string; storage_packs?: number; plan?: string; organization_id?: string | null } | null) {
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
        expect(db.updates()).toEqual([{ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO, machine_size: 'small', storage_packs: 0 }])
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 2, whatsapp_slot: 1, storage_pack: 0 }, { periodAdvanced: true })
    })

    it('holds a slot given back mid-period until the renewal', async () => {
        const db = useDb({ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        await applyLifetimeAddonsSubscription(subscription(), { adopt: false })
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 2, whatsapp_slot: 1, storage_pack: 0 }, { periodAdvanced: false })
    })

    it('keeps the slots of a renewal Stripe is still retrying', async () => {
        const db = useDb({ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        await applyLifetimeAddonsSubscription(subscription({ status: 'past_due' }), { adopt: false })
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 2, whatsapp_slot: 1, storage_pack: 0 }, { periodAdvanced: false })
    })

    it('gives every slot back at once when the subscription is over', async () => {
        const db = useDb({ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        await applyLifetimeAddonsSubscription(subscription({ status: 'canceled' }), { adopt: false })
        expect(m.syncWorkspaceAppSlots).toHaveBeenCalledWith(db.client, WORKSPACE_ID, { linkedin_slot: 0, whatsapp_slot: 0, storage_pack: 0 }, { periodAdvanced: true })
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
        expect(db.updates()).toEqual([{ stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO, machine_size: 'small', storage_packs: 0 }])
    })

    it('ignores a session of another customer', async () => {
        const db = useDb({ stripe_addons_subscription_id: null, addons_current_period_end: null })
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ id: 'cs_1', status: 'complete', customer: 'cus_other', subscription: 'sub_addons', metadata: { kind: 'lifetime_addons' } } as never)

        await settleLifetimeAddonsCheckout('cs_1')
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
        expect(db.updates()).toEqual([])
    })
})

describe('getLifetimeBillingState', () => {
    function useBillingRow(row: { stripe_customer_id: string | null; stripe_addons_subscription_id: string | null; addons_current_period_end: string | null }) {
        const fake = fakeSupabase(table => (table === 'workspaces' ? { data: row } : undefined))
        m.createServiceRoleClient.mockReturnValue(fake.client)
    }

    it('shows nothing billed for a workspace that never paid on Stripe', async () => {
        useBillingRow({ stripe_customer_id: null, stripe_addons_subscription_id: null, addons_current_period_end: null })

        await expect(getLifetimeBillingState()).resolves.toEqual({
            quantities: { linkedin_slot: 0, whatsapp_slot: 0, storage_pack: 0 },
            periodEnd: null,
            nextInvoice: null,
            cancelAtPeriodEnd: false,
            trialing: false,
            slotsCheckout: { trialDays: 5 },
            hasCustomer: false,
            business: { name: null, country: null, taxId: null },
            machineSize: 'small',
            heldMachine: { machineSize: 'small', storagePacks: 0 },
        })
        expect(stripe.customers.retrieve).not.toHaveBeenCalled()
    })

    it('keeps the invoices of a customer who only bought credit', async () => {
        useBillingRow({ stripe_customer_id: 'cus_1', stripe_addons_subscription_id: null, addons_current_period_end: null })
        vi.mocked(stripe.customers.retrieve).mockResolvedValue({ id: 'cus_1', name: 'Acme' } as never)

        const state = await getLifetimeBillingState()
        expect(state).toMatchObject({ hasCustomer: true, business: { name: 'Acme' }, nextInvoice: null, quantities: { linkedin_slot: 0, whatsapp_slot: 0, storage_pack: 0 } })
    })

    it('reads the slots and the next invoice of a live add-ons subscription', async () => {
        useBillingRow({ stripe_customer_id: 'cus_1', stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        vi.mocked(stripe.customers.retrieve).mockResolvedValue({ id: 'cus_1', name: null } as never)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscription() as never)
        m.readNextInvoice.mockResolvedValue({ at: PERIOD_END_ISO, amountCents: 2700 })

        await expect(getLifetimeBillingState()).resolves.toMatchObject({
            quantities: { linkedin_slot: 2, whatsapp_slot: 1, storage_pack: 0 },
            periodEnd: PERIOD_END_ISO,
            nextInvoice: { at: PERIOD_END_ISO, amountCents: 2700 },
            cancelAtPeriodEnd: false,
            trialing: false,
            slotsCheckout: null,
        })
    })

    it('bills nothing more once the last slot was given back', async () => {
        useBillingRow({ stripe_customer_id: 'cus_1', stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        vi.mocked(stripe.customers.retrieve).mockResolvedValue({ id: 'cus_1' } as never)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscription({ cancel_at_period_end: true }) as never)

        await expect(getLifetimeBillingState()).resolves.toMatchObject({ nextInvoice: null, cancelAtPeriodEnd: true, periodEnd: PERIOD_END_ISO })
        expect(m.readNextInvoice).not.toHaveBeenCalled()
    })

    it('reads an ended subscription as no slots at all', async () => {
        useBillingRow({ stripe_customer_id: 'cus_1', stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO })
        vi.mocked(stripe.customers.retrieve).mockResolvedValue({ id: 'cus_1' } as never)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscription({ status: 'canceled' }) as never)

        await expect(getLifetimeBillingState()).resolves.toMatchObject({ quantities: { linkedin_slot: 0, whatsapp_slot: 0, storage_pack: 0 }, periodEnd: null, nextInvoice: null, slotsCheckout: { trialDays: 0 } })
    })
})

describe('the machine of a lifetime workspace', () => {
    const LIFETIME = { stripe_addons_subscription_id: 'sub_addons', addons_current_period_end: PERIOD_END_ISO, plan: 'lifetime', organization_id: null }
    const withMachine = (...items: object[]) => subscription({ items: { data: [{ id: 'si_li', price: { id: 'price_linkedin_slot' }, quantity: 1, current_period_end: PERIOD_END }, ...items] } as never })

    it('writes the size and the storage the add-ons subscription pays for, held until the renewal', async () => {
        const db = useDb({ ...LIFETIME, machine_size: 'large', storage_packs: 0 })
        await applyLifetimeAddonsSubscription(withMachine({ id: 'si_m', price: { id: 'price_machine_medium' }, quantity: 1, current_period_end: PERIOD_END }, { id: 'si_s', price: { id: 'price_storage_pack' }, quantity: 2, current_period_end: PERIOD_END }), { adopt: false })
        expect(db.updates()).toEqual([expect.objectContaining({ machine_size: 'large', storage_packs: 2 })])
    })

    it('goes back to the included size once the subscription is over', async () => {
        const db = useDb({ ...LIFETIME, machine_size: 'large', storage_packs: 2 })
        await applyLifetimeAddonsSubscription(subscription({ status: 'canceled' }), { adopt: false })
        expect(db.updates()).toEqual([expect.objectContaining({ machine_size: 'small', storage_packs: 0 })])
    })

    it('refuses an AppSumo workspace and a plan that sells sizes itself', async () => {
        useDb({ ...LIFETIME, plan: 'lifetime_restricted' })
        await expect(changeLifetimeMachine({ machineSize: 'medium', storagePacks: 0 }, 'req-1')).rejects.toThrow('Machine sizes are not sold on this plan.')
        useDb({ ...LIFETIME, plan: 'base' })
        await expect(changeLifetimeMachine({ machineSize: 'medium', storagePacks: 0 }, 'req-1')).rejects.toThrow('Machine sizes are not sold on this plan.')
        expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    })

    it('sells the first size through Checkout, monthly and without a trial', async () => {
        useDb({ ...LIFETIME, stripe_addons_subscription_id: null })
        vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.test/cs_m' } as never)

        await expect(changeLifetimeMachine({ machineSize: 'large', storagePacks: 1 }, 'req-1')).resolves.toEqual({ checkoutUrl: 'https://checkout.stripe.test/cs_m', paymentClientSecret: null })
        const [params, options] = vi.mocked(stripe.checkout.sessions.create).mock.calls[0]!
        expect(params).toMatchObject({
            line_items: [
                { price: 'price_machine_large', quantity: 1 },
                { price: 'price_storage_pack', quantity: 1 },
            ],
            subscription_data: { metadata: { kind: 'lifetime_addons', workspace_id: '7' } },
            success_url: 'https://app.rerun.test/?billing=1&machine_session={CHECKOUT_SESSION_ID}',
        })
        expect(params?.subscription_data).not.toHaveProperty('trial_period_days')
        expect(options).toEqual({ idempotencyKey: 'lifetime-machine-req-1' })
    })

    it('puts a larger size on the live subscription, billed for the rest of the month', async () => {
        useDb(LIFETIME)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(withMachine({ id: 'si_m', price: { id: 'price_machine_medium' }, quantity: 1, current_period_end: PERIOD_END }) as never)
        m.updateWithPayment.mockResolvedValue(null)

        await changeLifetimeMachine({ machineSize: 'large', storagePacks: 0 }, 'req-1')

        expect(m.updateWithPayment).toHaveBeenCalledWith('sub_addons', { items: [{ id: 'si_m', price: 'price_machine_large', quantity: 1 }], proration_behavior: 'always_invoice' })
        expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    })

    it('lands a smaller size at the renewal, and ends a subscription left with nothing to bill', async () => {
        useDb(LIFETIME)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce(withMachine({ id: 'si_m', price: { id: 'price_machine_large' }, quantity: 1, current_period_end: PERIOD_END }) as never)
        await changeLifetimeMachine({ machineSize: 'medium', storagePacks: 0 }, 'req-1')
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce(subscription({ items: { data: [{ id: 'si_m', price: { id: 'price_machine_large' }, quantity: 1, current_period_end: PERIOD_END }] } as never }) as never)
        await changeLifetimeMachine({ machineSize: 'small', storagePacks: 0 }, 'req-2')

        expect(vi.mocked(stripe.subscriptions.update).mock.calls).toEqual([
            ['sub_addons', { items: [{ id: 'si_m', price: 'price_machine_medium', quantity: 1 }], proration_behavior: 'none' }],
            ['sub_addons', { cancel_at_period_end: true }],
        ])
        expect(m.updateWithPayment).not.toHaveBeenCalled()
    })

    it('waits for the app trial to end', async () => {
        useDb(LIFETIME)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscription({ status: 'trialing' }) as never)
        await expect(changeLifetimeMachine({ machineSize: 'medium', storagePacks: 0 }, 'req-1')).rejects.toThrow(/app trial/)
    })

    const MEDIUM_ITEM = { id: 'si_m', price: { id: 'price_machine_medium' }, quantity: 1, current_period_end: PERIOD_END }
    const STORAGE_ITEM = { id: 'si_s', price: { id: 'price_storage_pack' }, quantity: 3, current_period_end: PERIOD_END }

    it('bills a larger size first, and gives storage back only once it is paid', async () => {
        useDb(LIFETIME)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(withMachine(MEDIUM_ITEM, STORAGE_ITEM) as never)
        m.updateWithPayment.mockResolvedValue(null)

        await changeLifetimeMachine({ machineSize: 'large', storagePacks: 1 }, 'req-1')

        expect(m.updateWithPayment).toHaveBeenCalledWith('sub_addons', {
            items: [{ id: 'si_m', price: 'price_machine_large', quantity: 1 }],
            proration_behavior: 'always_invoice',
            metadata: { machine_change_after_payment: JSON.stringify({ machineSize: 'large', storagePacks: 1, givenBack: false }) },
        })
        expect(vi.mocked(stripe.subscriptions.update).mock.calls).toEqual([['sub_addons', { items: [{ id: 'si_s', quantity: 1 }], proration_behavior: 'none', metadata: { machine_change_after_payment: '' } }]])
    })

    it('gives nothing back while the bank holds the increase, and finishes the change once it confirms', async () => {
        useDb(LIFETIME)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(withMachine(MEDIUM_ITEM, STORAGE_ITEM) as never)
        m.updateWithPayment.mockResolvedValue('pi_secret')

        await expect(changeLifetimeMachine({ machineSize: 'large', storagePacks: 1 }, 'req-1')).resolves.toEqual({ checkoutUrl: null, paymentClientSecret: 'pi_secret' })
        expect(stripe.subscriptions.update).not.toHaveBeenCalled()

        const applied = withMachine({ ...MEDIUM_ITEM, price: { id: 'price_machine_large' } }, STORAGE_ITEM)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({ ...applied, metadata: { ...applied.metadata, machine_change_after_payment: JSON.stringify({ machineSize: 'large', storagePacks: 1, givenBack: false }) } } as never)
        await finishPendingLifetimeMachineChange(applied)
        expect(vi.mocked(stripe.subscriptions.update).mock.calls).toEqual([['sub_addons', { items: [{ id: 'si_s', quantity: 1 }], proration_behavior: 'none', metadata: { machine_change_after_payment: '' } }]])
    })

    it('finishes nothing for an applied update that carried no machine change', async () => {
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(withMachine(MEDIUM_ITEM) as never)
        await finishPendingLifetimeMachineChange(withMachine(MEDIUM_ITEM))
        expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    })

    it('never revives a slot given back when a size is bought on a subscription set to end', async () => {
        useDb(LIFETIME)
        const ending = subscription({ cancel_at_period_end: true, items: { data: [{ id: 'si_li', price: { id: 'price_linkedin_slot' }, quantity: 1, current_period_end: PERIOD_END }] } as never })
        const paid = subscription({ cancel_at_period_end: true, items: { data: [{ id: 'si_li', price: { id: 'price_linkedin_slot' }, quantity: 1, current_period_end: PERIOD_END }, MEDIUM_ITEM] } as never })
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce(ending as never).mockResolvedValueOnce(paid as never)
        m.updateWithPayment.mockResolvedValue(null)

        await changeLifetimeMachine({ machineSize: 'medium', storagePacks: 0 }, 'req-1')

        expect(m.updateWithPayment).toHaveBeenCalledWith('sub_addons', expect.objectContaining({ items: [{ price: 'price_machine_medium', quantity: 1 }] }))
        expect(vi.mocked(stripe.subscriptions.update).mock.calls).toEqual([
            ['sub_addons', { items: [{ id: 'si_li', deleted: true }], cancel_at_period_end: false, proration_behavior: 'none', metadata: { machine_change_after_payment: '' } }],
        ])
    })

    it('keeps a size given back off a subscription that runs on for a slot', async () => {
        const ending = subscription({ cancel_at_period_end: true, items: { data: [{ id: 'si_li', price: { id: 'price_linkedin_slot' }, quantity: 1, current_period_end: PERIOD_END }, MEDIUM_ITEM] } as never })
        await resumeLifetimeAddons(ending)
        expect(vi.mocked(stripe.subscriptions.update).mock.calls).toEqual([['sub_addons', { cancel_at_period_end: false, items: [{ id: 'si_m', deleted: true }], proration_behavior: 'none' }]])
    })

    it('waits for the slot before it resumes a subscription that carries nothing but a size given back', async () => {
        const ending = subscription({ cancel_at_period_end: true, items: { data: [MEDIUM_ITEM] } as never })
        await expect(resumeLifetimeAddons(ending)).resolves.toBe(ending)
        expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    })
})

