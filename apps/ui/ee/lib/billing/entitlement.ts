// A subscription that is merely late on an invoice is still a subscription: Stripe retries for
// days before giving up, so `past_due` keeps its plan, its price and its way back through the plan
// dialog until the subscription is really over. What it loses, a day after the first declined
// charge, is its machine, see isMachineEntitled.
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function isSubscriptionEntitled(status: string | null | undefined): boolean {
    return ENTITLED_STATUSES.has(status ?? '')
}

// Whether the workspace keeps a running machine for good. A declined charge leaves it one more day
// (decideTeardown), then pauses it: the archive costs the customer nothing but a restore, and paying
// the open invoice brings it back on the same subscription.
export function isMachineEntitled(status: string | null | undefined): boolean {
    return status === 'active' || status === 'trialing'
}

// Entitled AND having actually paid at least once. A trial is a real entitlement, so it opens the
// product, but it is the one state where nothing has been charged yet and the workspace can be
// thrown away at no cost: that is what the capabilities below key off.
export function isPaidSubscription(status: string | null | undefined): boolean {
    return isSubscriptionEntitled(status) && status !== 'trialing'
}

// A trial that ended without ever being paid for: cancelled for want of a card, or its first charge
// declined. `past_due` only counts before the first payment, because Stripe's weeks of retries are a
// grace a customer has earned and a trial has not. An `active` workspace with nothing paid yet is not
// lapsed: Stripe attempts the first charge about an hour after the trial ends, and until it does the
// honest answer is "not yet known".
export function isTrialLapsed(status: string | null | undefined, firstPaidAt: string | null | undefined): boolean {
    if (firstPaidAt) return false
    return !isSubscriptionEntitled(status) || status === 'past_due'
}

// The API follows the subscription, trial included: a key is how a trial gets to plug its own
// tools in. A key stops answering once the subscription is over, see authenticateApiKey.
export function isApiEntitled(status: string | null | undefined): boolean {
    return isSubscriptionEntitled(status)
}

// A sandbox carries no subscription of its own: it is an expert perk sitting on a fictitious
// `active` plan. Authoring templates goes through the MCP server, so a key is the tool the sandbox
// exists for, not a paid extra.
export function isWorkspaceApiEntitled(workspace: { subscription_status: string | null; is_sandbox: boolean }): boolean {
    return workspace.is_sandbox || isApiEntitled(workspace.subscription_status)
}

// Converting a trial into a paid subscription on the spot, at unchanged quantities. Shared by the
// server guard and the button that offers it, so the two can never disagree on who is eligible.
// A trial without a card has nothing to charge (those started before 2026-09-05), and one already
// set to cancel would be billed a cycle it is about to lose: both belong elsewhere in the dialog.
export function canEndTrialNow(subscription: { status: string | null | undefined; hasPaymentMethod: boolean; cancelAtPeriodEnd: boolean }): boolean {
    return subscription.status === 'trialing' && subscription.hasPaymentMethod && !subscription.cancelAtPeriodEnd
}
