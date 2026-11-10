// This build has no plans: every workspace is entitled to everything, without a limit on coworkers
// or seats, and nothing is ever sold. The pricing figures still exist because the shared contracts
// carry them for Rerun Cloud; nothing here quotes them.
import type { PriceArm, TrialCopy } from '@rerun/contracts'

export { PLAN_CURRENCY, TRIAL_ACTIVE_AGENTS, basePriceCents, parsePriceArm, type AddonKey, type PriceArm } from '@rerun/contracts'

export const BILLING_ENABLED = false

type WorkspacePlan = { subscription_status: string | null; is_sandbox: boolean }

export const isSubscriptionEntitled = (_status: string | null | undefined): boolean => true
export const isMachineEntitled = (_status: string | null | undefined): boolean => true
export const isPaidSubscription = (_status: string | null | undefined): boolean => true
export const isWorkspaceApiEntitled = (_workspace: WorkspacePlan): boolean => true
export const isPremiumModelEntitled = (_workspace: WorkspacePlan): boolean => true

// A lifetime plan is sold through an AppSumo code, which only Rerun Cloud redeems.
export const isLifetimePlan = (_workspace: { plan: string | null } | null | undefined): boolean => false

// null = unlimited. A number set by hand on the workspace row is still honoured.
export const activeAgentLimitFor = (maxAgents: number | null, _status: string | null | undefined): number | null => maxAgents

export const BASE_PLAN_SLUG = 'self_hosted'
export const MICROS_PER_USD = 1_000_000
export const SIGNUP_BUDGET_MICROS = 0

export type ModelAccess = 'best' | 'premium' | 'self_hosted'

export type WorkspaceLimitColumns = {
    max_agents: number | null
    max_seats: number | null
    model_access: ModelAccess
    custom_integrations: boolean
    rerun_budget_micros: number
}

export function baseLimitsToColumns(): WorkspaceLimitColumns {
    return { max_agents: null, max_seats: null, model_access: 'best', custom_integrations: true, rerun_budget_micros: 0 }
}

export type RerunCreditColumns = { rerun_budget_micros?: number | null; rerun_used_micros?: number | null; rerun_topup_micros?: number | null }

export function rerunCreditTotalMicros(_workspace: RerunCreditColumns | null | undefined): number {
    return 0
}

export const PRICE_EXPERIMENT_KEY = 'price1'
export const PRICE_PROPERTY = 'ab_price1'
export const drawPriceArm = (_request: { experimentCookie: string | undefined; consentCookie: string | undefined; userAgent: string | null }): PriceArm | null => null

export const TRIAL_CARD_PROPERTY = 'ab_trial_card'
export const trialArm = (_workspaceId: number): 'card' | 'cardless' => 'cardless'

export type TrialOffer = 'cardless' | 'card_trial' | 'paid'
export const trialOffer = (_workspace: { id: number; trial_ends_at: string | null; is_sandbox: boolean } | null | undefined): TrialOffer => 'paid'
export const trialOfferLine = (_priceArm: PriceArm, _offer: TrialOffer, _t: TrialCopy, _locale: string, _now?: Date): string => ''
