// What the app derives from the plan: the workspace limit columns, the Rerun credit accounting and
// the Stripe tax behaviour. Server-safe (no 'use client', no React imports) so both the billing
// service and the billing UI can consume it.
//
// The prices themselves live in @rerun/contracts, because the landing quotes the same figures. They
// are re-exported here so every billing surface keeps importing from one place.
//
// Pricing model: one base plan, extended by add-on quantities carried as items on the same Stripe
// subscription. The workspace limit columns are derived from those quantities by the webhook (see
// applySubscriptionToWorkspace); after that snapshot the columns are freely editable per workspace,
// independent of the subscription.

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
    trialLimitsLabel,
    yearlyDiscountPercent,
    type AddonKey,
    type AddonQuantities,
    type BillingInterval,
    type PriceArm,
} from '@rerun/contracts'

export const BASE_PLAN_SLUG = 'base'

// Every price Rerun mints, plan or template, is tax-exclusive: the figure quoted is the pre-tax
// base, Stripe adds the buyer's local tax on top, and a business buyer with a valid
// intra-community VAT number reverse-charges it back to zero. Shared from here because
// `tax_behavior` can only be written once per price: letting the setup script and the
// template pricing service drift would mean re-minting live prices to reconcile them.
export const TAX_BEHAVIOR = 'exclusive' as const

export const MODEL_ACCESS_VALUES = ['best', 'premium', 'self_hosted'] as const

export type ModelAccess = (typeof MODEL_ACCESS_VALUES)[number]

// Internal accounting unit for the Rerun demo budget: 1 USD = 1_000_000 micros.
// Integer micros avoid float drift when input/output token prices differ.
export const MICROS_PER_USD = 1_000_000

// The one credit a new account gets, from signup through the end of its trial: its first runs, the
// onboarding foreman being on the house. The trial adds no monthly budget on top. Granted as a
// top-up rather than as the budget, so no monthly reset can refill it and whatever is left carries
// over once the plan is paid.
export const SIGNUP_BUDGET_MICROS = TRIAL_CREDIT_USD * MICROS_PER_USD

export type RerunCreditColumns = { rerun_budget_micros?: number | null; rerun_used_micros?: number | null; rerun_topup_micros?: number | null }

// What the used credit is measured against. consume_rerun_credit counts every spend in
// rerun_used_micros and takes what overflows the month's budget off the top-up, so the whole is
// the budget (or what was spent past it) plus the top-up still left.
export function rerunCreditTotalMicros(workspace: RerunCreditColumns | null | undefined): number {
    return Math.max(workspace?.rerun_budget_micros ?? 0, workspace?.rerun_used_micros ?? 0) + (workspace?.rerun_topup_micros ?? 0)
}

// Shape of the workspace columns that hold the derived subscription limits.
export type WorkspaceLimitColumns = {
    // null = unlimited, what every paid plan gets. A number is the trial's cap, or one set by hand.
    max_agents: number | null
    // null = unlimited, what every plan and trial gets. A number is a cap set by hand from the admin.
    max_seats: number | null
    model_access: ModelAccess
    custom_integrations: boolean
    rerun_budget_micros: number
}

// Derive the workspace limit columns from add-on quantities. Coworkers, model access, custom
// integrations and seats are no longer differentiators: every subscribed workspace gets everything,
// so the team can be invited from day one. A trial is capped to TRIAL_ACTIVE_AGENTS by the webhook.
export function quantitiesToColumns(q: AddonQuantities): WorkspaceLimitColumns {
    return {
        max_agents: null,
        max_seats: null,
        model_access: 'best',
        custom_integrations: true,
        rerun_budget_micros: (BASE_PLAN.creditUsd + q.credit_pack * CREDIT_USD_PER_PACK) * MICROS_PER_USD,
    }
}

// The base plan with no add-ons, before anything is paid: the columns a workspace gets at signup.
export function baseLimitsToColumns(): WorkspaceLimitColumns {
    return quantitiesToColumns(ZERO_QUANTITIES)
}

export const LIFETIME_PLAN_SLUG = 'lifetime'

export function isLifetimePlan(workspace: { plan: string | null } | null | undefined): boolean {
    return workspace?.plan === LIFETIME_PLAN_SLUG
}

// What an AppSumo code buys for good: unlimited coworkers and seats on its machine, and no Rerun
// credit, so its coworkers run on the buyer's own AI key or subscription.
export function lifetimeLimitsToColumns(): WorkspaceLimitColumns {
    return { max_agents: null, max_seats: null, model_access: 'best', custom_integrations: true, rerun_budget_micros: 0 }
}

// workspaces.model_access is a plain text column, so a stored value can be anything.
export function isModelAccess(value?: string | null): value is ModelAccess {
    return !!value && (MODEL_ACCESS_VALUES as readonly string[]).includes(value)
}

export type PlanDiscounts = { interval: BillingInterval; monthlyDiscountCents: number }

// What still comes off each invoice once the plan is billed `interval`. A change of add-ons keeps
// the legacy base price and the subscription's promo. A change of interval moves the base item onto
// the price of its arm, so nothing is promised past it.
export function planDiscountCents(discounts: PlanDiscounts, interval: BillingInterval): number {
    if (interval !== discounts.interval) return 0
    return discounts.monthlyDiscountCents
}
