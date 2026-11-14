import { creditsFromUsd } from './credits.js'

// The subscription plan Rerun sells: one base plan extended by add-on quantities carried as items
// on the same Stripe subscription. Shared rather than app-local because the landing quotes the same
// figures as the billing dialog, and two hand-typed copies of a price drift the day one changes.
//
// Amounts are in minor units, like everything that crosses the Stripe boundary. Render them with
// `formatAmount(cents, PLAN_CURRENCY)`.

// The one currency Rerun sells in, and the one every Stripe Price is minted in. Named rather than
// left implicit because Checkout picks the buyer's currency from their IP unless it is passed.
export const PLAN_CURRENCY = 'usd'

// The free trial every new account starts on, behind the card form. Read by the checkout, the
// lifecycle emails and every line of copy that states it, so the number is written once.
export const TRIAL_DAYS = 5

// Three agents is what it takes to see a workspace work rather than a single agent in isolation. The
// paid plan has no cap: a trial builds every agent it plans, the ones past the third wait switched
// off until the trial converts.
export const TRIAL_ACTIVE_AGENTS = 3

// The one credit a new account gets, from signup through the end of its trial. The trial adds no
// monthly budget on top: the plan's monthly credit starts with the first charge.
export const TRIAL_CREDIT_USD = 3.5

export const TRIAL_CREDITS = creditsFromUsd(TRIAL_CREDIT_USD)

const DAY_MS = 86_400_000

// When a trial started now is charged: Stripe counts whole days from the moment the card is saved.
export function trialEndDate(from: Date = new Date()): Date {
    return new Date(from.getTime() + TRIAL_DAYS * DAY_MS)
}

// The `billing.trialOffer` catalog.
export type TrialCopy = (key: 'limitsDuringTrial' | 'chargeLine' | 'cardlessLine', values?: Record<string, string | number>) => string

export function trialLimitsCaption(t: TrialCopy): string {
    return t('limitsDuringTrial', { agents: TRIAL_ACTIVE_AGENTS, credits: TRIAL_CREDITS })
}

// The one sentence every trial offer says, so the card form never comes as a surprise and the charge
// is announced with its amount and its date wherever the trial is sold.
export function trialChargeLine(t: TrialCopy, price: string, chargeDate: string): string {
    return t('chargeLine', { price, date: chargeDate })
}

// The same sentence for the cardless arm of the trial test: nothing is asked today, and the trial
// only turns into the plan if a card is added before it ends.
export function cardlessTrialLine(t: TrialCopy, price: string, endDate: string): string {
    return t('cardlessLine', { price, date: endDate })
}

export const BILLING_INTERVALS = ['monthly', 'yearly'] as const

export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export const ADDON_KEYS = ['linkedin_slot', 'whatsapp_slot'] as const

export type AddonKey = (typeof ADDON_KEYS)[number]

// Every price, per billing interval. An app slot carries no yearly discount: each one is an account
// Rerun pays for by the month.
export const PLAN_PRICES_CENTS: Record<BillingInterval, Record<'base' | AddonKey, number>> = {
    monthly: { base: 4900, linkedin_slot: 900, whatsapp_slot: 900 },
    yearly: { base: 46800, linkedin_slot: 10800, whatsapp_slot: 10800 },
}

// The base plan is sold at two prices while the price test runs: a workspace is drawn into an arm
// when it is created and keeps it. The arm is named after its monthly price in dollars, and that
// name is what travels in the experiment cookie and sits in `workspaces.price_arm`.
export const PRICE_ARMS = ['49', '29'] as const

export type PriceArm = (typeof PRICE_ARMS)[number]

// The arm of the original Stripe prices: the env names without a suffix, the retention coupons
// without one, and what a legacy base price reads as. Not a price anyone is quoted any more.
export const LIST_PRICE_ARM: PriceArm = '49'

// The price of everyone the test never drew: the workspaces from before it, a crawler, a visitor
// who refused the cookie, a workspace provisioned from the mobile app.
export const DEFAULT_PRICE_ARM: PriceArm = '29'

export const BASE_PRICE_CENTS: Record<PriceArm, Record<BillingInterval, number>> = {
    '49': { monthly: PLAN_PRICES_CENTS.monthly.base, yearly: PLAN_PRICES_CENTS.yearly.base },
    '29': { monthly: 2900, yearly: 27600 },
}

export function parsePriceArm(raw: string | null | undefined): PriceArm {
    return PRICE_ARMS.find(arm => arm === raw) ?? DEFAULT_PRICE_ARM
}

export function basePriceCents(arm: PriceArm = LIST_PRICE_ARM, interval: BillingInterval = 'monthly'): number {
    return BASE_PRICE_CENTS[arm][interval]
}

// The plan runs as many coworkers as the workspace builds: there is no agent count to sell.
export const BASE_PLAN = {
    priceCents: PLAN_PRICES_CENTS.monthly.base,
    creditUsd: 5,
} as const

export const BASE_PLAN_CREDITS = creditsFromUsd(BASE_PLAN.creditUsd)

// A quantity of model spend rather than a discount, hence a whole-dollar figure and not cents:
// the models are billed to Rerun in dollars and the credit is granted in the same unit.
export const CREDIT_USD_PER_PACK = 10

export const CREDITS_PER_PACK = creditsFromUsd(CREDIT_USD_PER_PACK)

// A pack is bought once, outside the plan, and its credit never expires: no renewal resets it. No
// discount on it either: model credit is resold at cost.
export const CREDIT_PACK_PRICE_CENTS = 1000

export const MAX_CREDIT_PACKS_PER_PURCHASE = 100

// Monthly prices only, for the surfaces that quote a plain "per month" figure.
export const ADDONS: Record<AddonKey, { priceCents: number }> = {
    linkedin_slot: { priceCents: PLAN_PRICES_CENTS.monthly.linkedin_slot },
    whatsapp_slot: { priceCents: PLAN_PRICES_CENTS.monthly.whatsapp_slot },
}

export type AddonQuantities = Record<AddonKey, number>

export const ZERO_QUANTITIES: AddonQuantities = { linkedin_slot: 0, whatsapp_slot: 0 }

// What one invoice of the interval bills, before tax and discounts.
export function planPriceCents(quantities: AddonQuantities, interval: BillingInterval, arm: PriceArm = LIST_PRICE_ARM): number {
    const prices = PLAN_PRICES_CENTS[interval]
    return basePriceCents(arm, interval) + ADDON_KEYS.reduce((sum, key) => sum + quantities[key] * prices[key], 0)
}

export function monthlyTotalCents(quantities: AddonQuantities): number {
    return planPriceCents(quantities, 'monthly')
}

// The same plan brought back to one month, for "$39/mo, billed yearly" and for MRR.
export function perMonthCents(quantities: AddonQuantities, interval: BillingInterval, arm: PriceArm = LIST_PRICE_ARM): number {
    const total = planPriceCents(quantities, interval, arm)
    return interval === 'yearly' ? Math.round(total / 12) : total
}

// The yearly saving on the base plan, as a whole percentage, for the interval toggle. Read off the
// list price for both arms of the price test, so the toggle promises the same figure to everyone:
// $276 a year on $29 a month is a shade over it.
export function yearlyDiscountPercent(): number {
    return Math.round((1 - PLAN_PRICES_CENTS.yearly.base / (12 * PLAN_PRICES_CENTS.monthly.base)) * 100)
}
