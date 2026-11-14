import type Stripe from 'stripe'
import { isBasePriceId, isPlanPriceId } from './stripe'

export const TEMPLATE_PURCHASE_KIND = 'template_purchase'

export function isTemplateSubscription(subscription: Stripe.Subscription): boolean {
    if (subscription.metadata?.kind === TEMPLATE_PURCHASE_KIND) return true
    if (subscription.metadata?.plan) return false

    const items = subscription.items?.data ?? []
    return items.length > 0 && !items.some(item => isPlanPriceId(item.price?.id))
}

export function isTemplateCheckoutSession(session: Stripe.Checkout.Session): boolean {
    return session.metadata?.kind === TEMPLATE_PURCHASE_KIND
}

export function subscriptionPeriodEndIso(subscription: Stripe.Subscription): string | null {
    const items = subscription.items?.data ?? []
    const baseEnd = items.find(item => isBasePriceId(item.price?.id))?.current_period_end
    const maxItemEnd = items.reduce<number | undefined>((max, item) => {
        const end = item.current_period_end
        return end && (!max || end > max) ? end : max
    }, undefined)
    const end = baseEnd ?? maxItemEnd ?? (subscription as unknown as { current_period_end?: number }).current_period_end
    return end ? new Date(end * 1000).toISOString() : null
}

export function stripeTimestampIso(seconds: number | null | undefined): string | null {
    return seconds ? new Date(seconds * 1000).toISOString() : null
}
