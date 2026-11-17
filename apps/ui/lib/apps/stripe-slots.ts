// No 'server-only': the subscriber trial sweep converts trials from Trigger.dev.
import type Stripe from 'stripe'
import type { AddonKey } from '@rerun/contracts'
import { isLifetimePlan } from '@/ee/lib/billing/plans'
import { addonForPriceId, intervalOfItems, priceIdForAddon, stripe } from '@/ee/lib/billing/stripe'

export const SLOT_SUBSCRIPTION_COLUMNS = ['plan', 'stripe_subscription_id', 'stripe_addons_subscription_id'] as const

// The subscription a workspace's slots are billed on: its plan's, or for a lifetime workspace, which
// has no plan subscription, the one that carries nothing but its slots (see lifetime-addons.ts).
export function slotSubscriptionId(workspace: { plan: string | null; stripe_subscription_id: string | null; stripe_addons_subscription_id: string | null }): string | null {
    return isLifetimePlan(workspace) ? workspace.stripe_addons_subscription_id : workspace.stripe_subscription_id
}

export function slotItem(subscription: Stripe.Subscription, addonKey: AddonKey): Stripe.SubscriptionItem | undefined {
    return subscription.items.data.find(item => addonForPriceId(item.price?.id) === addonKey)
}

export function slotQuantity(subscription: Stripe.Subscription, addonKey: AddonKey): number {
    return subscription.items.data.filter(item => addonForPriceId(item.price?.id) === addonKey).reduce((sum, item) => sum + (item.quantity ?? 0), 0)
}

// A yearly plan waiting to turn monthly runs on a schedule whose next phase was written from the old
// items: a slot added beside it would vanish at the switch. Like any other change to the plan, it
// releases the schedule first, so the subscription takes direct updates again.
async function releasePendingSwitch(subscription: Stripe.Subscription): Promise<Stripe.Subscription> {
    if (!subscription.schedule) return subscription
    await stripe.subscriptionSchedules.release(typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule.id)
    return stripe.subscriptions.retrieve(subscription.id)
}

// The workspace trial's one slot, put on the subscription at $0: a trial prorates nothing, and
// leaving `trial_end` alone keeps the trial running, unlike changePlan which ends it on any add-on.
// The slot is then charged with the plan at conversion, and shows on the checkout's quote. The
// caller's idempotency key folds a double click into one item.
export async function addTrialSlot(subscription: Stripe.Subscription, addonKey: AddonKey, idempotencyKey: string): Promise<void> {
    if (subscription.status !== 'trialing') throw new Error('The workspace is no longer on its trial.')
    if (slotQuantity(subscription, addonKey) > 0) return
    const current = await releasePendingSwitch(subscription)
    await stripe.subscriptions.update(current.id, { items: [{ price: priceIdForAddon(addonKey, intervalOfItems(current.items.data)), quantity: 1 }], proration_behavior: 'none' }, { idempotencyKey })
}

// One more paid slot, billed now for what is left of the period, refused rather than left unpaid
// when the card declines: the same terms as any add-on bought from the billing dialog.
export async function addPaidSlot(subscription: Stripe.Subscription, addonKey: AddonKey, idempotencyKey: string): Promise<void> {
    const current = await releasePendingSwitch(subscription)
    const item = slotItem(current, addonKey)
    const change = item ? { id: item.id, quantity: (item.quantity ?? 0) + 1 } : { price: priceIdForAddon(addonKey, intervalOfItems(current.items.data)), quantity: 1 }
    await stripe.subscriptions.update(current.id, { items: [change], proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' }, { idempotencyKey })
}
