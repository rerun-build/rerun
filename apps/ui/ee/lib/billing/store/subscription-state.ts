import type { Database } from '@/app/api/database.types'
import { maxLimit, mergeHeldLimits, type HeldLimitColumns } from '@/ee/lib/billing/held-limits'
import { hasPeriodAdvanced, rerunPeriodUpdate } from '@/ee/lib/billing/period'
import { BASE_PLAN_SLUG, ZERO_QUANTITIES, quantitiesToColumns } from '@/ee/lib/billing/plans'
import { DEFAULT_PRICE_ARM, TRIAL_ACTIVE_AGENTS, type StoreProvider } from '@rerun/contracts'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

// A store subscription as the hub reads it, whichever store sells it: Apple's transaction and renewal
// info, Google's subscription purchase, each mapped onto this one shape and written by
// storeWorkspaceUpdate onto the columns the Stripe webhook fills. Every reading is the whole state at
// that moment, never a delta, so notifications arriving out of order converge on the latest one.
export type StoreSubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

export type StoreSubscriptionState = {
    provider: StoreProvider
    // Apple's originalTransactionId, Google's purchase token: the same for every renewal.
    subscriptionId: string
    // The uuid the app passed to the purchase, null when the store gave none back.
    accountToken: string | null
    environment: string
    productId: string
    status: StoreSubscriptionStatus
    // Set while the free week runs, from the transaction that started it.
    trialStartedAt: string | null
    trialEndsAt: string | null
    periodEnd: string | null
    // When access ends because auto-renewal was switched off in the store, null while it renews.
    cancelAt: string | null
    // A paid period is behind this reading: the first one stamps first_paid_at.
    paid: boolean
    // Refunded or revoked by the store, reported apart from a plain expiry.
    revoked: boolean
}

export type StoreWorkspaceRow = HeldLimitColumns & {
    current_period_end: string | null
    subscription_status: string | null
    first_paid_at: string | null
}

export const STORE_WORKSPACE_COLUMNS = [
    'id',
    'current_period_end',
    'subscription_status',
    'first_paid_at',
    'max_agents',
    'max_seats',
    'rerun_budget_micros',
    'billing_provider',
    'store_subscription_id',
    'store_account_token',
    'trial_ends_at',
    'is_sandbox',
    'plan',
    'stripe_subscription_id',
] as const

// The columns a reading writes onto its workspace, mirroring what applySubscriptionToWorkspace does
// for a Stripe subscription:
// - trialing and active carry the whole plan: base limits held mid-period, the credit window moved
//   with the period, the trial's cap on coworkers and its signup credit;
// - past_due only flags the failure, once, the way markSubscriptionPastDue does, and the teardown
//   counts its grace from it;
// - canceled only ends the right to run, the way markSubscriptionCanceled does.
// `trial_ends_at` and `trial_started_at` are never cleared: non-null marks the workspace's trial spent.
export function storeWorkspaceUpdate(existing: StoreWorkspaceRow | null, state: StoreSubscriptionState, now: Date): WorkspaceUpdate {
    const linkage: WorkspaceUpdate = {
        billing_provider: state.provider,
        store_subscription_id: state.subscriptionId,
        store_environment: state.environment,
        subscription_status: state.status,
        subscription_cancel_at: state.cancelAt,
        ...(state.trialEndsAt ? { trial_ends_at: state.trialEndsAt } : {}),
        ...(state.trialStartedAt ? { trial_started_at: state.trialStartedAt } : {}),
        ...(state.paid && !existing?.first_paid_at ? { first_paid_at: now.toISOString() } : {}),
    }

    if (state.status === 'canceled') return linkage
    if (state.status === 'past_due') {
        return { ...linkage, ...(existing?.subscription_status === 'past_due' ? {} : { payment_failed_at: now.toISOString() }) }
    }

    const derived = quantitiesToColumns(ZERO_QUANTITIES)
    const advanced = hasPeriodAdvanced(existing?.current_period_end, state.periodEnd)
    const limits = advanced || !existing ? derived : mergeHeldLimits(existing, derived)
    const update: WorkspaceUpdate = {
        ...linkage,
        current_period_end: state.periodEnd,
        plan: BASE_PLAN_SLUG,
        price_arm: DEFAULT_PRICE_ARM,
        ...limits,
        ...rerunPeriodUpdate(advanced, state.status, now.toISOString()),
    }

    if (state.status === 'trialing') {
        update.rerun_budget_micros = existing?.rerun_budget_micros ?? 0
        update.max_agents = maxLimit(existing?.max_agents ?? TRIAL_ACTIVE_AGENTS, TRIAL_ACTIVE_AGENTS)
    }
    return update
}

// A reading of a period older than the one the workspace already holds: an Apple notification
// delivered late (a SUBSCRIBED landing after the DID_RENEW that followed it) carries the transaction
// of its own day, which read now would say the subscription lapsed. The same period, a refund or an
// expiry of it, is not older and goes through.
export function isStaleReading(existing: { store_subscription_id: string | null; current_period_end: string | null } | null, state: StoreSubscriptionState): boolean {
    if (!existing?.current_period_end || !state.periodEnd || existing.store_subscription_id !== state.subscriptionId) return false
    return Date.parse(state.periodEnd) < Date.parse(existing.current_period_end)
}
