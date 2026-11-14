import Stripe from 'stripe'
import { ADDON_KEYS, BASE_PLAN, BILLING_INTERVALS, LIST_PRICE_ARM, PLAN_CURRENCY, PRICE_ARMS, ZERO_QUANTITIES, type AddonKey, type AddonQuantities, type BillingInterval, type PriceArm } from './plans'

const UNSET_KEY = 'sk_unset'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || UNSET_KEY)

type PlanPriceKey = 'base' | AddonKey

const PRICE_ENV_NAMES: Record<BillingInterval, Record<PlanPriceKey, string>> = {
    monthly: { base: 'STRIPE_PRICE_BASE', credit_pack: 'STRIPE_PRICE_CREDIT_PACK', linkedin_slot: 'STRIPE_PRICE_LINKEDIN_SLOT', whatsapp_slot: 'STRIPE_PRICE_WHATSAPP_SLOT' },
    yearly: {
        base: 'STRIPE_PRICE_BASE_YEARLY',
        credit_pack: 'STRIPE_PRICE_CREDIT_PACK_YEARLY',
        linkedin_slot: 'STRIPE_PRICE_LINKEDIN_SLOT_YEARLY',
        whatsapp_slot: 'STRIPE_PRICE_WHATSAPP_SLOT_YEARLY',
    },
}

const BASE_PRICE_ENV_NAMES: Record<PriceArm, Record<BillingInterval, string>> = {
    '49': { monthly: PRICE_ENV_NAMES.monthly.base, yearly: PRICE_ENV_NAMES.yearly.base },
    '29': { monthly: 'STRIPE_PRICE_BASE_29', yearly: 'STRIPE_PRICE_BASE_29_YEARLY' },
}

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

export function isLegacySeatPriceId(priceId?: string | null): boolean {
    return !!priceId && priceId === process.env.STRIPE_PRICE_SEAT
}

const LEGACY_AGENT_PACK_ENV_NAMES = ['STRIPE_PRICE_AGENT_PACK', 'STRIPE_PRICE_AGENT_PACK_YEARLY'] as const

export function isLegacyAgentPackPriceId(priceId?: string | null): boolean {
    return !!priceId && LEGACY_AGENT_PACK_ENV_NAMES.some(name => process.env[name] === priceId)
}

export function isLegacyPlanItemPriceId(priceId?: string | null): boolean {
    return isLegacySeatPriceId(priceId) || isLegacyAgentPackPriceId(priceId)
}

export function isBasePriceId(priceId?: string | null): boolean {
    if (!priceId) return false
    return priceId === process.env.STRIPE_PRICE_BASE_LEGACY || PRICE_ARMS.some(arm => BILLING_INTERVALS.some(interval => configuredBasePriceId(arm, interval) === priceId))
}

export function isYearlyBasePriceId(priceId?: string | null): boolean {
    return !!priceId && PRICE_ARMS.some(arm => configuredBasePriceId(arm, 'yearly') === priceId)
}

export function priceArmOfItems(items: Stripe.SubscriptionItem[]): PriceArm {
    const priceId = items.find(item => isBasePriceId(item.price?.id))?.price?.id
    return PRICE_ARMS.find(arm => BILLING_INTERVALS.some(interval => configuredBasePriceId(arm, interval) === priceId)) ?? LIST_PRICE_ARM
}

export function intervalOfItems(items: Stripe.SubscriptionItem[]): BillingInterval {
    const base = items.find(item => isBasePriceId(item.price?.id))
    if (isYearlyBasePriceId(base?.price?.id)) return 'yearly'
    return base?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly'
}

export function legacyBaseDiscountCents(items: Stripe.SubscriptionItem[]): number {
    const price = items.find(item => isBasePriceId(item.price?.id))?.price
    if (!price || price.id !== process.env.STRIPE_PRICE_BASE_LEGACY || price.currency !== PLAN_CURRENCY || price.unit_amount == null) return 0
    return Math.max(0, BASE_PLAN.priceCents - price.unit_amount)
}

export function isPlanPriceId(priceId?: string | null): boolean {
    if (!priceId) return false
    return isBasePriceId(priceId) || !!addonForPriceId(priceId) || isLegacyPlanItemPriceId(priceId)
}

export async function subscriptionOfInvoice(invoice: Stripe.Invoice): Promise<Stripe.Subscription | null> {
    const parent = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent
    const fromParent = parent?.subscription_details?.subscription
    const legacy = (invoice as unknown as { subscription?: string | Stripe.Subscription | null }).subscription
    const value = fromParent ?? legacy
    if (!value) return null

    return stripe.subscriptions.retrieve(typeof value === 'string' ? value : value.id)
}

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
