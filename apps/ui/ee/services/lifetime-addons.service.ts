import type Stripe from 'stripe'
import { ADDON_KEYS, PLAN_CURRENCY, TRIAL_DAYS, ZERO_QUANTITIES, type AddonKey } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { LIFETIME_ADDONS_CONSENT } from '@/ee/lib/billing/consent'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { isLifetimeAddonsCheckoutSession, isLifetimeAddonsSubscription, LIFETIME_ADDONS_KIND } from '@/ee/lib/billing/lifetime-addons'
import { subscriptionPeriodEndIso } from '@/ee/lib/billing/marketplace'
import { hasPeriodAdvanced } from '@/ee/lib/billing/period'
import { idOf, priceIdForAddon, quantitiesFromItems, stripe } from '@/ee/lib/billing/stripe'
import { getAppOrigin } from '@/lib/app-origin'
import { syncWorkspaceAppSlots } from '@/lib/apps/slots-sync'
import { slotItem, slotQuantity } from '@/lib/apps/stripe-slots'
import { PAID_APP_PARAM, SLOTS_CHECKOUT_PARAM, type AppSlug } from '@/lib/apps/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ensureStripeCustomer, findWorkspaceId, PLAN_PAYMENT_METHOD_TYPES } from './billing.service'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

// The slots of a lifetime workspace, from the subscription that carries nothing but them. The plan,
// its status and its limits are never touched: the machine of a lifetime workspace does not depend on
// what it pays for its slots.
//
// `adopt` is true for a purchase (Checkout completed, subscription created), false for the lifecycle
// events of a subscription that must already be the workspace's own.
export async function applyLifetimeAddonsSubscription(subscription: Stripe.Subscription, { adopt }: { adopt: boolean }): Promise<void> {
    const workspaceId = await findWorkspaceId(subscription)
    if (!workspaceId) return

    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['stripe_addons_subscription_id', 'addons_current_period_end'] as const, { id: workspaceId })
    if (!workspace) return
    if (!adopt && workspace.stripe_addons_subscription_id !== subscription.id) {
        console.warn(`[billing] ignoring add-ons subscription ${subscription.id} for workspace ${workspaceId}, which holds ${workspace.stripe_addons_subscription_id}`)
        return
    }

    // A subscription that is over gives every slot back at once: there is no paid period left to hold.
    const live = isSubscriptionEntitled(subscription.status)
    const periodEnd = subscriptionPeriodEndIso(subscription)
    const periodAdvanced = !live || hasPeriodAdvanced(workspace.addons_current_period_end, periodEnd)

    const { error } = await supabase
        .from('workspaces')
        .update<WorkspaceUpdate>({ stripe_addons_subscription_id: subscription.id, addons_current_period_end: periodEnd })
        .eq('id', workspaceId)
    if (error) throw error

    const { quantities } = quantitiesFromItems(subscription.items?.data ?? [])
    await syncWorkspaceAppSlots(supabase, workspaceId, live ? quantities : ZERO_QUANTITIES, { periodAdvanced })
}

// A live add-ons subscription Stripe holds for the workspace that the workspace row does not know
// yet: a Checkout completed whose webhook has not landed. Adopted rather than sold twice.
export async function adoptPendingLifetimeAddonsSubscription(): Promise<boolean> {
    const { customerId } = await ensureStripeCustomer()
    const { data: subscriptions } = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    const pending = subscriptions.find(subscription => isLifetimeAddonsSubscription(subscription) && isSubscriptionEntitled(subscription.status))
    if (!pending) return false
    await applyLifetimeAddonsSubscription(pending, { adopt: true })
    return true
}

// The first slot of a lifetime workspace: a subscription made of that slot alone, sold through
// Checkout because there is no card on file. Monthly only. The free trial comes with the first one
// the workspace ever starts.
export async function createLifetimeAddonsCheckout(slug: AppSlug, addonKey: AddonKey, requestId: string, { trial }: { trial: boolean }): Promise<string> {
    const { workspaceId, customerId } = await ensureStripeCustomer()
    const origin = await getAppOrigin()
    const metadata: Stripe.MetadataParam = { kind: LIFETIME_ADDONS_KIND, workspace_id: String(workspaceId) }

    const checkout = await stripe.checkout.sessions.create(
        {
            mode: 'subscription',
            customer: customerId,
            line_items: [{ price: priceIdForAddon(addonKey, 'monthly'), quantity: 1 }],
            // Same trap as the plan checkout: left out, Stripe picks the currency from the buyer's IP.
            currency: PLAN_CURRENCY,
            subscription_data: { metadata, ...(trial ? { trial_period_days: TRIAL_DAYS } : {}) },
            payment_method_collection: 'always',
            payment_method_types: PLAN_PAYMENT_METHOD_TYPES,
            automatic_tax: { enabled: true },
            tax_id_collection: { enabled: true },
            customer_update: { address: 'auto', name: 'auto' },
            ...LIFETIME_ADDONS_CONSENT,
            metadata,
            // {CHECKOUT_SESSION_ID} is a Stripe literal, not a template hole to interpolate.
            success_url: `${origin}/?${PAID_APP_PARAM}=${slug}&${SLOTS_CHECKOUT_PARAM}={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/?${PAID_APP_PARAM}=${slug}`,
        },
        { idempotencyKey: `lifetime-addons-${requestId}` },
    )
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL')
    return checkout.url
}

// Back from Checkout: the slot opens now rather than when the webhook lands, which repeats the same
// idempotent sync. Only a session of this workspace's own customer is read.
export async function settleLifetimeAddonsCheckout(sessionId: string): Promise<void> {
    const { customerId } = await ensureStripeCustomer()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (!isLifetimeAddonsCheckoutSession(session) || idOf(session.customer) !== customerId || session.status !== 'complete') return
    const subscriptionId = idOf(session.subscription)
    if (subscriptionId) await applyLifetimeAddonsSubscription(await stripe.subscriptions.retrieve(subscriptionId), { adopt: true })
}

// One slot fewer, from the next renewal: nothing is refunded, and the slot keeps working until the
// period it was paid for ends (heldSlots). Stripe keeps at least one item on a subscription, so giving
// back the last slot ends the subscription with the period instead.
export async function removeLifetimeAddonSlot(subscription: Stripe.Subscription, addonKey: AddonKey): Promise<void> {
    const item = slotItem(subscription, addonKey)
    if (!item) return
    const total = ADDON_KEYS.reduce((sum, key) => sum + slotQuantity(subscription, key), 0)
    if (total <= 1) {
        await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })
        return
    }
    const quantity = item.quantity ?? 0
    const change = quantity > 1 ? { id: item.id, quantity: quantity - 1 } : { id: item.id, deleted: true }
    await stripe.subscriptions.update(subscription.id, { items: [change], proration_behavior: 'none' })
}

// A subscription set to end that is asked for a slot again runs on: what it still carries is already
// paid until the renewal.
export async function resumeLifetimeAddons(subscription: Stripe.Subscription): Promise<Stripe.Subscription> {
    if (!subscription.cancel_at_period_end) return subscription
    return stripe.subscriptions.update(subscription.id, { cancel_at_period_end: false })
}
