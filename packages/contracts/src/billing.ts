import { creditsFromUsd } from './credits.js'

export const PLAN_CURRENCY = 'usd'

export const TRIAL_DAYS = 5

export const TRIAL_ACTIVE_AGENTS = 3

export const TRIAL_CREDIT_USD = 3.5

export const TRIAL_CREDITS = creditsFromUsd(TRIAL_CREDIT_USD)

const DAY_MS = 86_400_000

export function trialEndDate(from: Date = new Date()): Date {
    return new Date(from.getTime() + TRIAL_DAYS * DAY_MS)
}

export type TrialCopy = (key: 'limitsDuringTrial' | 'chargeLine' | 'cardlessLine', values?: Record<string, string | number>) => string

export function trialLimitsCaption(t: TrialCopy): string {
    return t('limitsDuringTrial', { agents: TRIAL_ACTIVE_AGENTS, credits: TRIAL_CREDITS })
}

export function trialChargeLine(t: TrialCopy, price: string, chargeDate: string): string {
    return t('chargeLine', { price, date: chargeDate })
}

export function cardlessTrialLine(t: TrialCopy, price: string, endDate: string): string {
    return t('cardlessLine', { price, date: endDate })
}

export const BILLING_INTERVALS = ['monthly', 'yearly'] as const

export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export const ADDON_KEYS = ['credit_pack', 'linkedin_slot', 'whatsapp_slot'] as const

export type AddonKey = (typeof ADDON_KEYS)[number]

export const PLAN_PRICES_CENTS: Record<BillingInterval, Record<'base' | AddonKey, number>> = {
    monthly: { base: 4900, credit_pack: 1000, linkedin_slot: 900, whatsapp_slot: 900 },
    yearly: { base: 46800, credit_pack: 12000, linkedin_slot: 10800, whatsapp_slot: 10800 },
}

export const PRICE_ARMS = ['49', '29'] as const

export type PriceArm = (typeof PRICE_ARMS)[number]

export const LIST_PRICE_ARM: PriceArm = '49'

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

export const BASE_PLAN = {
    priceCents: PLAN_PRICES_CENTS.monthly.base,
    creditUsd: 5,
} as const

export const BASE_PLAN_CREDITS = creditsFromUsd(BASE_PLAN.creditUsd)

export const CREDIT_USD_PER_PACK = 10

export const CREDITS_PER_PACK = creditsFromUsd(CREDIT_USD_PER_PACK)

export const ADDONS: Record<AddonKey, { priceCents: number }> = {
    credit_pack: { priceCents: PLAN_PRICES_CENTS.monthly.credit_pack },
    linkedin_slot: { priceCents: PLAN_PRICES_CENTS.monthly.linkedin_slot },
    whatsapp_slot: { priceCents: PLAN_PRICES_CENTS.monthly.whatsapp_slot },
}

export type AddonQuantities = Record<AddonKey, number>

export const ZERO_QUANTITIES: AddonQuantities = { credit_pack: 0, linkedin_slot: 0, whatsapp_slot: 0 }

export function planPriceCents(quantities: AddonQuantities, interval: BillingInterval, arm: PriceArm = LIST_PRICE_ARM): number {
    const prices = PLAN_PRICES_CENTS[interval]
    return basePriceCents(arm, interval) + ADDON_KEYS.reduce((sum, key) => sum + quantities[key] * prices[key], 0)
}

export function monthlyTotalCents(quantities: AddonQuantities): number {
    return planPriceCents(quantities, 'monthly')
}

export function perMonthCents(quantities: AddonQuantities, interval: BillingInterval, arm: PriceArm = LIST_PRICE_ARM): number {
    const total = planPriceCents(quantities, interval, arm)
    return interval === 'yearly' ? Math.round(total / 12) : total
}

export function yearlyDiscountPercent(): number {
    return Math.round((1 - PLAN_PRICES_CENTS.yearly.base / (12 * PLAN_PRICES_CENTS.monthly.base)) * 100)
}
