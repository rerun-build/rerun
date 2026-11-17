import type Stripe from 'stripe'

// The subscription a lifetime workspace holds its LinkedIn and WhatsApp slots on, beside a plan that
// has no subscription. Its add-on items look like a plan's, so only this tag tells them apart.
export const LIFETIME_ADDONS_KIND = 'lifetime_addons'

export function isLifetimeAddonsSubscription(subscription: Stripe.Subscription): boolean {
    return subscription.metadata?.kind === LIFETIME_ADDONS_KIND
}

export function isLifetimeAddonsCheckoutSession(session: Stripe.Checkout.Session): boolean {
    return session.metadata?.kind === LIFETIME_ADDONS_KIND
}
