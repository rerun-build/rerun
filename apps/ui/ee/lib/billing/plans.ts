import { BASE_PLAN, CREDIT_USD_PER_PACK, TRIAL_CREDIT_USD, ZERO_QUANTITIES, type AddonQuantities, type BillingInterval } from '@rerun/contracts'

export {
    ADDONS,
    ADDON_KEYS,
    BASE_PLAN,
    BASE_PLAN_CREDITS,
    BASE_PRICE_CENTS,
    BILLING_INTERVALS,
    CREDITS_PER_PACK,
    CREDIT_USD_PER_PACK,
    DEFAULT_PRICE_ARM,
    LIST_PRICE_ARM,
    PLAN_CURRENCY,
    PLAN_PRICES_CENTS,
    PRICE_ARMS,
    TRIAL_ACTIVE_AGENTS,
    TRIAL_CREDITS,
    TRIAL_CREDIT_USD,
    TRIAL_DAYS,
    ZERO_QUANTITIES,
    creditsFromMicros,
    creditsFromUsd,
    creditsLabel,
    formatCredits,
    basePriceCents,
    cardlessTrialLine,
    monthlyTotalCents,
    parsePriceArm,
    perMonthCents,
    planPriceCents,
    trialChargeLine,
    trialEndDate,
    trialLimitsCaption,
    yearlyDiscountPercent,
    type AddonKey,
    type AddonQuantities,
    type BillingInterval,
    type PriceArm,
} from '@rerun/contracts'

export const BASE_PLAN_SLUG = 'base'

export const TAX_BEHAVIOR = 'exclusive' as const

export const MODEL_ACCESS_VALUES = ['best', 'premium', 'self_hosted'] as const

export type ModelAccess = (typeof MODEL_ACCESS_VALUES)[number]

export const MICROS_PER_USD = 1_000_000

export const SIGNUP_BUDGET_MICROS = TRIAL_CREDIT_USD * MICROS_PER_USD

export type RerunCreditColumns = { rerun_budget_micros?: number | null; rerun_used_micros?: number | null; rerun_topup_micros?: number | null }

export function rerunCreditTotalMicros(workspace: RerunCreditColumns | null | undefined): number {
    return Math.max(workspace?.rerun_budget_micros ?? 0, workspace?.rerun_used_micros ?? 0) + (workspace?.rerun_topup_micros ?? 0)
}

export type WorkspaceLimitColumns = {
    max_agents: number | null
    max_seats: number | null
    model_access: ModelAccess
    custom_integrations: boolean
    rerun_budget_micros: number
}

export function quantitiesToColumns(q: AddonQuantities): WorkspaceLimitColumns {
    return {
        max_agents: null,
        max_seats: null,
        model_access: 'best',
        custom_integrations: true,
        rerun_budget_micros: (BASE_PLAN.creditUsd + q.credit_pack * CREDIT_USD_PER_PACK) * MICROS_PER_USD,
    }
}

export function baseLimitsToColumns(): WorkspaceLimitColumns {
    return quantitiesToColumns(ZERO_QUANTITIES)
}

export const LIFETIME_PLAN_SLUG = 'lifetime'

export function isLifetimePlan(workspace: { plan: string | null } | null | undefined): boolean {
    return workspace?.plan === LIFETIME_PLAN_SLUG
}

export function lifetimeLimitsToColumns(): WorkspaceLimitColumns {
    return { max_agents: null, max_seats: null, model_access: 'best', custom_integrations: true, rerun_budget_micros: 0 }
}

export function isModelAccess(value?: string | null): value is ModelAccess {
    return !!value && (MODEL_ACCESS_VALUES as readonly string[]).includes(value)
}

export type PlanDiscounts = { interval: BillingInterval; monthlyDiscountCents: number }

export function planDiscountCents(discounts: PlanDiscounts, interval: BillingInterval): number {
    if (interval !== discounts.interval) return 0
    return discounts.monthlyDiscountCents
}
