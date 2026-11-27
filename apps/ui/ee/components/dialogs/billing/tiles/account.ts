import { MICROS_PER_CREDIT } from '@rerun/contracts'

import { basePriceCents, planDiscountCents, planPriceCents, type AddonQuantities, type BillingInterval } from '@/ee/lib/billing/plans'
import type { SubscriptionState } from '@/ee/services/billing.service'

// The state the billing home opens on, the first that applies: what needs the user goes before what
// only informs them.
export type TilesAccountState = 'past_due' | 'canceling' | 'trial' | 'low' | 'yearly' | 'active'

// Under this many credits the home warns that the coworkers on the Rerun models are about to stop.
export const LOW_CREDITS = 100

type AccountFacts = Pick<SubscriptionState, 'status' | 'cancelAtPeriodEnd' | 'interval'>

export function tilesAccountState(state: AccountFacts, creditsLeftMicros: number | null): TilesAccountState {
    if (state.status === 'past_due') return 'past_due'
    if (state.cancelAtPeriodEnd) return 'canceling'
    if (state.status === 'trialing') return 'trial'
    if (creditsLeftMicros !== null && creditsLeftMicros < LOW_CREDITS * MICROS_PER_CREDIT) return 'low'
    return state.interval === 'yearly' ? 'yearly' : 'active'
}

export type PlanBadge = { kind: 'trial' | 'ends' | 'declined' | 'monthlyFrom' | 'yearly' | 'monthly'; tone: 'green' | 'brand' | 'orange' | 'red' | 'yellow' }

export function planBadge(state: Pick<SubscriptionState, 'status' | 'cancelAtPeriodEnd' | 'interval' | 'pendingSwitch'>): PlanBadge {
    if (state.status === 'past_due') return { kind: 'declined', tone: 'red' }
    if (state.cancelAtPeriodEnd) return { kind: 'ends', tone: 'orange' }
    if (state.status === 'trialing') return { kind: 'trial', tone: 'brand' }
    if (state.pendingSwitch) return { kind: 'monthlyFrom', tone: 'yellow' }
    return { kind: state.interval === 'yearly' ? 'yearly' : 'monthly', tone: 'green' }
}

// What the plan bills each interval at `quantities`, with the legacy price and the promos it keeps.
export function planBillCents(state: Pick<SubscriptionState, 'interval' | 'monthlyDiscountCents'>, quantities: AddonQuantities, interval: BillingInterval): number {
    return Math.max(0, planPriceCents(quantities, interval) - planDiscountCents(state, interval))
}

// What a year billed yearly saves on twelve months of the base plan.
export function yearlySavingsCents(): number {
    return basePriceCents('monthly') * 12 - basePriceCents('yearly')
}

const DAY_MS = 86_400_000

export function daysLeft(until: string, now: number): number {
    return Math.max(0, Math.ceil((Date.parse(until) - now) / DAY_MS))
}
