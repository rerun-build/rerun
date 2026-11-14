import type Stripe from 'stripe'
import type { AddonKey } from '@rerun/contracts'
import { addonForPriceId, intervalOfItems, priceIdForAddon, stripe } from '@/ee/lib/billing/stripe'

export function slotItem(subscription: Stripe.Subscription, addonKey: AddonKey): Stripe.SubscriptionItem | undefined {
    return subscription.items.data.find(item => addonForPriceId(item.price?.id) === addonKey)
}

export function slotQuantity(subscription: Stripe.Subscription, addonKey: AddonKey): number {
    return subscription.items.data.filter(item => addonForPriceId(item.price?.id) === addonKey).reduce((sum, item) => sum + (item.quantity ?? 0), 0)
}

async function releasePendingSwitch(subscription: Stripe.Subscription): Promise<Stripe.Subscription> {
    if (!subscription.schedule) return subscription
    await stripe.subscriptionSchedules.release(typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule.id)
    return stripe.subscriptions.retrieve(subscription.id)
}

export async function addTrialSlot(subscription: Stripe.Subscription, addonKey: AddonKey, idempotencyKey: string): Promise<void> {
    if (subscription.status !== 'trialing') throw new Error('The workspace is no longer on its trial.')
    if (slotQuantity(subscription, addonKey) > 0) return
    const current = await releasePendingSwitch(subscription)
    await stripe.subscriptions.update(current.id, { items: [{ price: priceIdForAddon(addonKey, intervalOfItems(current.items.data)), quantity: 1 }], proration_behavior: 'none' }, { idempotencyKey })
}

export async function addPaidSlot(subscription: Stripe.Subscription, addonKey: AddonKey, idempotencyKey: string): Promise<void> {
    const current = await releasePendingSwitch(subscription)
    const item = slotItem(current, addonKey)
    const change = item ? { id: item.id, quantity: (item.quantity ?? 0) + 1 } : { price: priceIdForAddon(addonKey, intervalOfItems(current.items.data)), quantity: 1 }
    await stripe.subscriptions.update(current.id, { items: [change], proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' }, { idempotencyKey })
}
