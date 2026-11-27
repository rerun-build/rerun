import type Stripe from 'stripe'

// The subscription a lifetime workspace holds its app slots, its machine size and its storage on,
// beside a plan that has no subscription. Its add-on items look like a plan's, so only this tag tells them apart.
export const LIFETIME_ADDONS_KIND = 'lifetime_addons'

export function isLifetimeAddonsSubscription(subscription: Stripe.Subscription): boolean {
    return subscription.metadata?.kind === LIFETIME_ADDONS_KIND
}

// Back from the Checkout that put a machine size or storage on a lifetime workspace's subscription.
export const MACHINE_CHECKOUT_PARAM = 'machine_session'

export function isLifetimeAddonsCheckoutSession(session: Stripe.Checkout.Session): boolean {
    return session.metadata?.kind === LIFETIME_ADDONS_KIND
}
