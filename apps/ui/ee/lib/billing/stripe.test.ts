import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BASE_PLAN } from './plans'
import { addonForPriceId, basePriceId, intervalOfItems, isBasePriceId, isLegacyAgentPackPriceId, isLegacyCreditPackPriceId, isLegacyPlanItemPriceId, isPlanPriceId, isYearlyBasePriceId, legacyBaseDiscountCents, priceArmOfItems, priceIdForAddon, quantitiesFromItems, stripe, subscriptionOfInvoice } from './stripe'

function item(priceId: string | null, quantity?: number, price: Partial<Stripe.Price> = {}): Stripe.SubscriptionItem {
    return { id: `si_${priceId}`, quantity, price: priceId === null ? null : { id: priceId, currency: 'usd', unit_amount: BASE_PLAN.priceCents, ...price } } as unknown as Stripe.SubscriptionItem
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('quantitiesFromItems', () => {
    it('counts a workspace on the legacy base price as having the base plan', () => {
        expect(quantitiesFromItems([item('price_base_legacy', 1)]).hasBase).toBe(true)
    })

    it('adds up the quantities of duplicate add-on items and counts nothing for a legacy seat or agent pack', () => {
        const { hasBase, quantities } = quantitiesFromItems([item('price_base', 1), item('price_whatsapp_slot', 2), item('price_whatsapp_slot', 3), item('price_agent_pack', 2), item('price_agent_pack_yearly', 1), item('price_seat', 1)])
        expect(hasBase).toBe(true)
        expect(quantities).toEqual({ linkedin_slot: 0, whatsapp_slot: 5 })
    })

    it('counts nothing for a legacy recurring credit pack, in either interval', () => {
        expect(quantitiesFromItems([item('price_base', 1), item('price_credit_pack', 3), item('price_credit_pack_yearly', 1)])).toEqual({ hasBase: true, quantities: { linkedin_slot: 0, whatsapp_slot: 0 } })
    })

    it('reads a yearly plan like a monthly one', () => {
        expect(quantitiesFromItems([item('price_base_yearly', 1), item('price_agent_pack_yearly', 2), item('price_whatsapp_slot_yearly', 1)])).toEqual({ hasBase: true, quantities: { linkedin_slot: 0, whatsapp_slot: 1 } })
    })

    it('ignores an item on a price that is not part of the plan', () => {
        expect(quantitiesFromItems([item('price_template', 4), item(null, 2)])).toEqual({ hasBase: false, quantities: { linkedin_slot: 0, whatsapp_slot: 0 } })
    })

    it('counts an add-on item without a quantity as zero', () => {
        expect(quantitiesFromItems([item('price_whatsapp_slot')]).quantities.whatsapp_slot).toBe(0)
    })
})

describe('legacyBaseDiscountCents', () => {
    it('gives the difference between the legacy price and the list price', () => {
        expect(legacyBaseDiscountCents([item('price_agent_pack', 1), item('price_base_legacy', 1, { unit_amount: 2400 })])).toBe(BASE_PLAN.priceCents - 2400)
    })

    it('reads nothing off a base price in another currency', () => {
        expect(legacyBaseDiscountCents([item('price_base_legacy', 1, { unit_amount: 2400, currency: 'eur' })])).toBe(0)
    })

    it('reads nothing off a price without a unit amount', () => {
        expect(legacyBaseDiscountCents([item('price_base_legacy', 1, { unit_amount: null })])).toBe(0)
    })

    it('never turns a price above the list price into a negative discount', () => {
        expect(legacyBaseDiscountCents([item('price_base', 1, { unit_amount: BASE_PLAN.priceCents + 1000 })])).toBe(0)
    })

    it('is zero without a base item', () => {
        expect(legacyBaseDiscountCents([item('price_seat', 1)])).toBe(0)
    })

    it('never reads the $29 arm of the price test as a grandfathered price', () => {
        expect(legacyBaseDiscountCents([item('price_base_29', 1, { unit_amount: 2900 })])).toBe(0)
        expect(legacyBaseDiscountCents([item('price_base_29_yearly', 1, { unit_amount: 27600 })])).toBe(0)
    })
})

describe('the LinkedIn slot', () => {
    it('reads as a plan add-on, never as a template purchase', () => {
        expect(quantitiesFromItems([item('price_base', 1), item('price_linkedin_slot', 2)])).toEqual({ hasBase: true, quantities: { linkedin_slot: 2, whatsapp_slot: 0 } })
        expect(isPlanPriceId('price_linkedin_slot_yearly')).toBe(true)
    })
})

describe('the arms of the price test', () => {
    it('gives each arm its own base price, per interval', () => {
        expect(basePriceId('monthly', '49')).toBe('price_base')
        expect(basePriceId('monthly', '29')).toBe('price_base_29')
        expect(basePriceId('yearly', '29')).toBe('price_base_29_yearly')
    })

    it('names the missing variable of an arm that is not configured', () => {
        vi.stubEnv('STRIPE_PRICE_BASE_29_YEARLY', '')
        expect(() => basePriceId('yearly', '29')).toThrow(/STRIPE_PRICE_BASE_29_YEARLY/)
    })

    it('counts a $29 base price as the base plan', () => {
        expect(isBasePriceId('price_base_29')).toBe(true)
        expect(isBasePriceId('price_base_29_yearly')).toBe(true)
        expect(quantitiesFromItems([item('price_base_29', 1), item('price_agent_pack', 2)])).toEqual({ hasBase: true, quantities: { linkedin_slot: 0, whatsapp_slot: 0 } })
    })

    it('knows the yearly price of either arm', () => {
        expect(isYearlyBasePriceId('price_base_yearly')).toBe(true)
        expect(isYearlyBasePriceId('price_base_29_yearly')).toBe(true)
        expect(isYearlyBasePriceId('price_base_29')).toBe(false)
        expect(intervalOfItems([item('price_base_29_yearly', 1)])).toBe('yearly')
    })

    it('reads the arm a subscription was sold on off its base item', () => {
        expect(priceArmOfItems([item('price_agent_pack', 1), item('price_base_29', 1)])).toBe('29')
        expect(priceArmOfItems([item('price_base_29_yearly', 1)])).toBe('29')
        expect(priceArmOfItems([item('price_base_yearly', 1)])).toBe('49')
    })

    it('reads a legacy base price, or no base item at all, as the list price', () => {
        expect(priceArmOfItems([item('price_base_legacy', 1)])).toBe('49')
        expect(priceArmOfItems([item('price_seat', 1)])).toBe('49')
    })
})

describe('price id lookups', () => {
    it('refuses an empty price id as a plan price', () => {
        expect(isPlanPriceId(null)).toBe(false)
        expect(isPlanPriceId('')).toBe(false)
        expect(isPlanPriceId(undefined)).toBe(false)
    })

    it('recognises the base, legacy, yearly and add-on prices as plan prices, the agent packs no longer sold included', () => {
        for (const id of ['price_base', 'price_base_legacy', 'price_base_yearly', 'price_agent_pack', 'price_agent_pack_yearly', 'price_seat', 'price_credit_pack', 'price_credit_pack_yearly']) {
            expect(isPlanPriceId(id)).toBe(true)
        }
        expect(isPlanPriceId('price_template')).toBe(false)
    })

    it('maps each add-on price back to its key, whatever its interval', () => {
        expect(addonForPriceId('price_agent_pack')).toBeUndefined()
        expect(addonForPriceId('price_agent_pack_yearly')).toBeUndefined()
        expect(addonForPriceId('price_seat')).toBeUndefined()
        expect(addonForPriceId('price_credit_pack')).toBeUndefined()
        expect(addonForPriceId('price_credit_pack_yearly')).toBeUndefined()
        expect(addonForPriceId('price_whatsapp_slot')).toBe('whatsapp_slot')
        expect(addonForPriceId('price_whatsapp_slot_yearly')).toBe('whatsapp_slot')
        expect(addonForPriceId('price_base')).toBeUndefined()
        expect(addonForPriceId(null)).toBeUndefined()
    })

    it('knows the base price in its current, yearly and legacy form', () => {
        expect(isBasePriceId('price_base')).toBe(true)
        expect(isBasePriceId('price_base_yearly')).toBe(true)
        expect(isBasePriceId('price_base_legacy')).toBe(true)
        expect(isBasePriceId('price_seat')).toBe(false)
        expect(isBasePriceId(null)).toBe(false)
    })

    it('names the missing variable when the base price is not configured', () => {
        vi.stubEnv('STRIPE_PRICE_BASE', '')
        expect(() => basePriceId()).toThrow(/STRIPE_PRICE_BASE/)
    })

    it('returns the configured price for each interval', () => {
        expect(basePriceId()).toBe('price_base')
        expect(basePriceId('yearly')).toBe('price_base_yearly')
        expect(priceIdForAddon('whatsapp_slot', 'yearly')).toBe('price_whatsapp_slot_yearly')
    })

    it('names the missing yearly variable', () => {
        vi.stubEnv('STRIPE_PRICE_WHATSAPP_SLOT_YEARLY', '')
        expect(() => priceIdForAddon('whatsapp_slot', 'yearly')).toThrow(/STRIPE_PRICE_WHATSAPP_SLOT_YEARLY/)
    })

    it('knows an agent pack price in either interval as a legacy item, and nothing else', () => {
        expect(isLegacyAgentPackPriceId('price_agent_pack')).toBe(true)
        expect(isLegacyAgentPackPriceId('price_agent_pack_yearly')).toBe(true)
        expect(isLegacyAgentPackPriceId('price_credit_pack')).toBe(false)
        expect(isLegacyAgentPackPriceId(null)).toBe(false)
    })

    it('knows a recurring credit pack price in either interval as a legacy plan item', () => {
        for (const id of ['price_credit_pack', 'price_credit_pack_yearly']) {
            expect(isLegacyCreditPackPriceId(id)).toBe(true)
            expect(isLegacyPlanItemPriceId(id)).toBe(true)
            expect(isPlanPriceId(id)).toBe(true)
        }
        expect(isLegacyCreditPackPriceId('price_credit_once')).toBe(false)
        expect(isLegacyCreditPackPriceId('price_agent_pack')).toBe(false)
        expect(isLegacyCreditPackPriceId(null)).toBe(false)
    })

    it('recognises no agent pack once its variables are gone', () => {
        vi.stubEnv('STRIPE_PRICE_AGENT_PACK', '')
        vi.stubEnv('STRIPE_PRICE_AGENT_PACK_YEARLY', '')
        expect(isLegacyAgentPackPriceId('')).toBe(false)
        expect(isLegacyAgentPackPriceId('price_agent_pack')).toBe(false)
    })
})

describe('intervalOfItems', () => {
    it('reads the interval off the base item', () => {
        expect(intervalOfItems([item('price_agent_pack_yearly', 1), item('price_base_yearly', 1)])).toBe('yearly')
        expect(intervalOfItems([item('price_base', 1)])).toBe('monthly')
        expect(intervalOfItems([item('price_base_legacy', 1)])).toBe('monthly')
    })
})

// subscriptionOfInvoice calls the module's own client, which a vi.mock of the export would not
// reach, so the real instance is spied on instead.
describe('subscriptionOfInvoice', () => {
    function spyRetrieve() {
        return vi.spyOn(stripe.subscriptions, 'retrieve').mockImplementation((async (id: string) => ({ id }) as unknown as Stripe.Response<Stripe.Subscription>) as never)
    }

    it('prefers the subscription under parent.subscription_details over the legacy field', async () => {
        const retrieve = spyRetrieve()
        const invoice = { parent: { subscription_details: { subscription: 'sub_parent' } }, subscription: 'sub_legacy' } as unknown as Stripe.Invoice
        await expect(subscriptionOfInvoice(invoice)).resolves.toEqual({ id: 'sub_parent' })
        expect(retrieve).toHaveBeenCalledWith('sub_parent')
    })

    it('reads an expanded subscription object by its id', async () => {
        const retrieve = spyRetrieve()
        await subscriptionOfInvoice({ parent: { subscription_details: { subscription: { id: 'sub_obj' } } } } as unknown as Stripe.Invoice)
        expect(retrieve).toHaveBeenCalledWith('sub_obj')
    })

    it('falls back on the legacy top-level subscription, string or object', async () => {
        const retrieve = spyRetrieve()
        await subscriptionOfInvoice({ subscription: 'sub_legacy' } as unknown as Stripe.Invoice)
        await subscriptionOfInvoice({ subscription: { id: 'sub_legacy_obj' } } as unknown as Stripe.Invoice)
        expect(retrieve.mock.calls.map(([id]) => id)).toEqual(['sub_legacy', 'sub_legacy_obj'])
    })

    it('answers null without asking Stripe when the invoice has no subscription', async () => {
        const retrieve = spyRetrieve()
        await expect(subscriptionOfInvoice({ parent: null } as unknown as Stripe.Invoice)).resolves.toBeNull()
        expect(retrieve).not.toHaveBeenCalled()
    })
})
