import Stripe from 'stripe'
import { ADDON_KEYS, BASE_PLAN, BILLING_INTERVALS, LIST_PRICE_ARM, PLAN_CURRENCY, PRICE_ARMS, ZERO_QUANTITIES, type AddonKey, type AddonQuantities, type BillingInterval, type PriceArm } from './plans'

// A deployment that sells nothing has no key. The client still builds, so the routes that import it
// load (Next evaluates them at build time), and a call it should never make fails on authentication.
const UNSET_KEY = 'sk_unset'

// Server-only Stripe client. Never import this from a 'use client' module.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || UNSET_KEY)

type PlanPriceKey = 'base' | AddonKey

// Price ids read from env (see cloud/packages/cloud/scripts/setup-billing-prices.ts, which creates the
// products/prices and prints these values). The prices carry metadata in Stripe; the
// env mapping keeps the lookup cheap and avoids a round-trip on every checkout.
const PRICE_ENV_NAMES: Record<BillingInterval, Record<PlanPriceKey, string>> = {
    monthly: { base: 'STRIPE_PRICE_BASE', credit_pack: 'STRIPE_PRICE_CREDIT_PACK', linkedin_slot: 'STRIPE_PRICE_LINKEDIN_SLOT', whatsapp_slot: 'STRIPE_PRICE_WHATSAPP_SLOT' },
    yearly: {
        base: 'STRIPE_PRICE_BASE_YEARLY',
        credit_pack: 'STRIPE_PRICE_CREDIT_PACK_YEARLY',
        linkedin_slot: 'STRIPE_PRICE_LINKEDIN_SLOT_YEARLY',
        whatsapp_slot: 'STRIPE_PRICE_WHATSAPP_SLOT_YEARLY',
    },
}

// The base plan has one price per arm of the price test. The list arm keeps the variables it had
// before the test, so nothing moves for the subscriptions already on them.
const BASE_PRICE_ENV_NAMES: Record<PriceArm, Record<BillingInterval, string>> = {
    '49': { monthly: PRICE_ENV_NAMES.monthly.base, yearly: PRICE_ENV_NAMES.yearly.base },
    '29': { monthly: 'STRIPE_PRICE_BASE_29', yearly: 'STRIPE_PRICE_BASE_29_YEARLY' },
}

// Read on every call rather than captured at import, so a test can stub one variable.
function configuredPriceId(key: PlanPriceKey, interval: BillingInterval): string | undefined {
    return process.env[PRICE_ENV_NAMES[interval][key]] || undefined
}

function configuredBasePriceId(arm: PriceArm, interval: BillingInterval): string | undefined {
    return process.env[BASE_PRICE_ENV_NAMES[arm][interval]] || undefined
}

function requirePriceId(key: PlanPriceKey, interval: BillingInterval): string {
    const id = configuredPriceId(key, interval)
    if (!id) throw new Error(`No Stripe price configured for "${key}" billed ${interval} (set ${PRICE_ENV_NAMES[interval][key]})`)
    return id
}

export function basePriceId(interval: BillingInterval = 'monthly', arm: PriceArm = LIST_PRICE_ARM): string {
    const id = configuredBasePriceId(arm, interval)
    if (!id) throw new Error(`No Stripe price configured for the $${arm} base plan billed ${interval} (set ${BASE_PRICE_ENV_NAMES[arm][interval]})`)
    return id
}

export function priceIdForAddon(key: AddonKey, interval: BillingInterval = 'monthly'): string {
    return requirePriceId(key, interval)
}

export function addonForPriceId(priceId?: string | null): AddonKey | undefined {
    if (!priceId) return undefined
    return ADDON_KEYS.find(key => BILLING_INTERVALS.some(interval => configuredPriceId(key, interval) === priceId))
}

// The seat add-on is no longer sold: a paid plan has unlimited seats. Subscriptions from before
// still carry its item until it is removed, and it must keep reading as part of the plan meanwhile,
// or a subscription holding it would be routed to the marketplace.
export function isLegacySeatPriceId(priceId?: string | null): boolean {
    return !!priceId && priceId === process.env.STRIPE_PRICE_SEAT
}

// The agent pack is no longer sold either: a paid plan runs as many coworkers as it builds. Same
// reasoning as the seat: until its item is removed, it still belongs to the plan.
const LEGACY_AGENT_PACK_ENV_NAMES = ['STRIPE_PRICE_AGENT_PACK', 'STRIPE_PRICE_AGENT_PACK_YEARLY'] as const

export function isLegacyAgentPackPriceId(priceId?: string | null): boolean {
    return !!priceId && LEGACY_AGENT_PACK_ENV_NAMES.some(name => process.env[name] === priceId)
}

// An item the plan no longer sells, deleted by any change made to the plan.
export function isLegacyPlanItemPriceId(priceId?: string | null): boolean {
    return isLegacySeatPriceId(priceId) || isLegacyAgentPackPriceId(priceId)
}

// The base plan's price. Read straight from the env rather than through basePriceId(): asking
// "is this the base item?" must not throw when the variable is missing.
//
// STRIPE_PRICE_BASE_LEGACY is the $24 price the base plan sold at before $49. Nobody new is put on
// it, but the workspaces subscribed back then stay on it for good and still get the whole plan.
export function isBasePriceId(priceId?: string | null): boolean {
    if (!priceId) return false
    return priceId === process.env.STRIPE_PRICE_BASE_LEGACY || PRICE_ARMS.some(arm => BILLING_INTERVALS.some(interval => configuredBasePriceId(arm, interval) === priceId))
}

export function isYearlyBasePriceId(priceId?: string | null): boolean {
    return !!priceId && PRICE_ARMS.some(arm => configuredBasePriceId(arm, 'yearly') === priceId)
}

// The arm of the price test a subscription was sold on, read off its base item. Once a workspace
// subscribes, this is what prices every later change, so a switch of interval or of packs keeps the
// price it signed up at whatever happens to the test. A legacy base price belongs to no arm and
// reads as the list price, which legacyBaseDiscountCents then brings back to what it bills.
export function priceArmOfItems(items: Stripe.SubscriptionItem[]): PriceArm {
    const priceId = items.find(item => isBasePriceId(item.price?.id))?.price?.id
    return PRICE_ARMS.find(arm => BILLING_INTERVALS.some(interval => configuredBasePriceId(arm, interval) === priceId)) ?? LIST_PRICE_ARM
}

// Read off the base item: every item of a subscription bills on the same interval.
export function intervalOfItems(items: Stripe.SubscriptionItem[]): BillingInterval {
    const base = items.find(item => isBasePriceId(item.price?.id))
    if (isYearlyBasePriceId(base?.price?.id)) return 'yearly'
    return base?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly'
}

// What a workspace still on a legacy base price saves every month against the list price, so the
// figures derived from the plan table can be brought back to what it is actually billed.
export function legacyBaseDiscountCents(items: Stripe.SubscriptionItem[]): number {
    const price = items.find(item => isBasePriceId(item.price?.id))?.price
    if (!price || price.id !== process.env.STRIPE_PRICE_BASE_LEGACY || price.currency !== PLAN_CURRENCY || price.unit_amount == null) return 0
    return Math.max(0, BASE_PLAN.priceCents - price.unit_amount)
}

// A price belonging to the Rerun plan subscription: the base plan or one of its
// add-ons. Anything else on the customer is a marketplace template purchase.
export function isPlanPriceId(priceId?: string | null): boolean {
    if (!priceId) return false
    return isBasePriceId(priceId) || !!addonForPriceId(priceId) || isLegacyPlanItemPriceId(priceId)
}

// The one-time price of a credit pack, bought on its own and never renewed.
export function creditPackOncePriceId(): string {
    const id = process.env.STRIPE_PRICE_CREDIT_ONCE
    if (!id) throw new Error('No Stripe price configured for a one-time credit pack (set STRIPE_PRICE_CREDIT_ONCE)')
    return id
}

export function idOf(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null
    return typeof value === 'string' ? value : value.id
}

// The invoice's subscription moved under `parent.subscription_details` in recent API versions;
// older events still carry the legacy top-level field.
export async function subscriptionOfInvoice(invoice: Stripe.Invoice): Promise<Stripe.Subscription | null> {
    const parent = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent
    const fromParent = parent?.subscription_details?.subscription
    const legacy = (invoice as unknown as { subscription?: string | Stripe.Subscription | null }).subscription
    const value = fromParent ?? legacy
    if (!value) return null

    return stripe.subscriptions.retrieve(typeof value === 'string' ? value : value.id)
}

// Read the plan state off a subscription's items: whether the base plan is present, and
// each add-on's quantity. A legacy seat or agent pack item counts for nothing: neither is sold.
export function quantitiesFromItems(items: Stripe.SubscriptionItem[]): { hasBase: boolean; quantities: AddonQuantities } {
    let hasBase = false
    const quantities: AddonQuantities = { ...ZERO_QUANTITIES }

    for (const item of items) {
        const priceId = item.price?.id
        if (isBasePriceId(priceId)) {
            hasBase = true
            continue
        }
        const addon = addonForPriceId(priceId)
        if (addon) quantities[addon] += item.quantity ?? 0
    }

    return { hasBase, quantities }
}
