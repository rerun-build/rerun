import { isSubscriptionEntitled } from './entitlement'
import { isStoreProvider } from '@rerun/contracts'

// A workspace has exactly one plan subscription: the one its `stripe_subscription_id` points at.
// Nothing stops a Stripe customer from carrying several, though — a renewal that failed leaves its
// subscription alive and retrying for days while the user re-subscribes through Checkout — and every
// one of them emits `customer.subscription.*` and `invoice.*` events resolving to the same workspace.
// Without these predicates a dead-but-retrying orphan flips the workspace to past_due, or cancels it,
// over a subscription that is paid and current.

// Statuses a workspace's stored subscription can be in and still be worth protecting. Anything
// outside this set is over, so a newly created subscription is free to take its place.
const REPLACEABLE_STATUSES = new Set(['canceled', 'incomplete_expired', 'unpaid', 'paused'])

// Is this the subscription the workspace is currently billed on? A workspace with no subscription
// at all has nothing to protect, so it answers yes.
export function isSameSubscription(storedSubscriptionId: string | null | undefined, incomingSubscriptionId: string): boolean {
    return !storedSubscriptionId || storedSubscriptionId === incomingSubscriptionId
}

// May this subscription become the workspace's plan subscription? Yes when the workspace has none,
// when it is already this one, or when the one it holds is over.
export function shouldAdoptSubscription(
    stored: { id: string | null | undefined; status: string | null | undefined },
    incomingSubscriptionId: string,
): boolean {
    if (isSameSubscription(stored.id, incomingSubscriptionId)) return true
    return REPLACEABLE_STATUSES.has(stored.status ?? '')
}

// A workspace the mobile app's store bills while that subscription runs. Stripe's events for a plan
// it held before (a renewal still retrying, a cancellation landing late) must leave it alone: the
// store's notifications are the ones that move its status now.
export function isStoreBilled(workspace: { billing_provider: string | null; subscription_status: string | null } | null | undefined): boolean {
    return isStoreProvider(workspace?.billing_provider) && isSubscriptionEntitled(workspace?.subscription_status)
}
