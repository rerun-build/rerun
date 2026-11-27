import type Stripe from 'stripe'
import { ADDON_MAX_QUANTITIES, INCLUDED_MACHINE_SIZE, PLAN_CURRENCY, TRIAL_DAYS, ZERO_QUANTITIES, isMachineSize, parseMachineSize, type AddonKey, type AddonQuantities, type MachineSize } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { LIFETIME_ADDONS_CONSENT, LIFETIME_MACHINE_CONSENT } from '@/ee/lib/billing/consent'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { isLifetimeAddonsCheckoutSession, isLifetimeAddonsSubscription, LIFETIME_ADDONS_KIND, MACHINE_CHECKOUT_PARAM } from '@/ee/lib/billing/lifetime-addons'
import { arePaidAppsOffered, LIFETIME_PLAN_SLUG } from '@/ee/lib/billing/plans'
import { subscriptionPeriodEndIso } from '@/ee/lib/billing/marketplace'
import { hasPeriodAdvanced } from '@/ee/lib/billing/period'
import { addonForPriceId, idOf, machineOfItems, machinePriceId, machineSizeForPriceId, priceIdForAddon, quantitiesFromItems, stripe } from '@/ee/lib/billing/stripe'
import { AppError } from '@/lib/i18n/action-error'
import { getAppOrigin } from '@/lib/app-origin'
import { syncWorkspaceAppSlots } from '@/lib/apps/slots-sync'
import { slotItem } from '@/lib/apps/stripe-slots'
import { PAID_APP_PARAM, SLOTS_CHECKOUT_PARAM, type AppSlug } from '@/lib/apps/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { machineColumns, planItemChanges } from '@/ee/lib/billing/plan-items'
import { businessDetailsOf, ensureStripeCustomer, findWorkspaceId, PLAN_PAYMENT_METHOD_TYPES, readNextInvoice, updateWithPayment, type BusinessDetails } from './billing.service'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

// The slots, the machine size and the storage of a lifetime workspace, from the subscription that
// carries nothing but them. The plan, its status and its limits are never touched: the machine of a
// lifetime workspace keeps running whatever becomes of this subscription, at the included size once
// nothing pays for a larger one.
//
// `adopt` is true for a purchase (Checkout completed, subscription created), false for the lifecycle
// events of a subscription that must already be the workspace's own.
export async function applyLifetimeAddonsSubscription(subscription: Stripe.Subscription, { adopt }: { adopt: boolean }): Promise<void> {
    const workspaceId = await findWorkspaceId(subscription)
    if (!workspaceId) return

    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['stripe_addons_subscription_id', 'addons_current_period_end', 'machine_size', 'storage_packs'] as const, { id: workspaceId })
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
        .update<WorkspaceUpdate>({
            stripe_addons_subscription_id: subscription.id,
            addons_current_period_end: periodEnd,
            ...machineColumns(live ? (subscription.items?.data ?? []) : [], workspace, { held: !periodAdvanced }),
        })
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
// back the last thing it carries ends the subscription with the period instead.
export async function removeLifetimeAddonSlot(subscription: Stripe.Subscription, addonKey: AddonKey): Promise<void> {
    const item = slotItem(subscription, addonKey)
    if (!item) return
    const total = subscription.items.data.reduce((sum, each) => sum + (each.quantity ?? 0), 0)
    if (total <= 1) {
        await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })
        return
    }
    const quantity = item.quantity ?? 0
    const change = quantity > 1 ? { id: item.id, quantity: quantity - 1 } : { id: item.id, deleted: true }
    await stripe.subscriptions.update(subscription.id, { items: [change], proration_behavior: 'none' })
}

export type LifetimeBillingState = {
    quantities: AddonQuantities
    // The machine size the add-ons subscription pays for, and the size and storage the workspace keeps
    // until the renewal when it gave some back.
    machineSize: MachineSize
    heldMachine: { machineSize: MachineSize; storagePacks: number }
    // The renewal of the add-ons subscription, null without one.
    periodEnd: string | null
    nextInvoice: { at: string; amountCents: number } | null
    cancelAtPeriodEnd: boolean
    // Its free trial is running: one slot per app until it ends.
    trialing: boolean
    // No live add-ons subscription: the next slot is bought alone through Checkout, free for
    // `trialDays` when it is the first one the workspace ever starts.
    slotsCheckout: { trialDays: number } | null
    // A workspace that never paid anything has no Stripe customer: no invoices, no business details.
    hasCustomer: boolean
    business: BusinessDetails
}

// What the billing dialog of a lifetime workspace shows: the plan was paid once outside Stripe, so the
// only thing billed again is the subscription that carries its app slots.
export async function getLifetimeBillingState(): Promise<LifetimeBillingState> {
    const workspaceId = await requireWorkspaceId()
    const { data: workspace } = await selectMaybeSingle(
        createServiceRoleClient(),
        'workspaces',
        ['stripe_customer_id', 'stripe_addons_subscription_id', 'addons_current_period_end', 'machine_size', 'storage_packs'] as const,
        { id: workspaceId },
    )
    const [customer, subscription] = await Promise.all([
        workspace?.stripe_customer_id ? stripe.customers.retrieve(workspace.stripe_customer_id, { expand: ['tax_ids'] }) : null,
        workspace?.stripe_addons_subscription_id ? stripe.subscriptions.retrieve(workspace.stripe_addons_subscription_id) : null,
    ])
    const live = subscription && isSubscriptionEntitled(subscription.status) ? subscription : null
    const liveCustomer = customer && !customer.deleted ? customer : null

    return {
        quantities: live ? quantitiesFromItems(live.items.data).quantities : ZERO_QUANTITIES,
        machineSize: live ? machineOfItems(live.items.data).size : INCLUDED_MACHINE_SIZE,
        heldMachine: { machineSize: parseMachineSize(workspace?.machine_size), storagePacks: workspace?.storage_packs ?? 0 },
        periodEnd: live ? (workspace?.addons_current_period_end ?? null) : null,
        nextInvoice: live && !live.cancel_at_period_end ? await readNextInvoice(live) : null,
        cancelAtPeriodEnd: !!live?.cancel_at_period_end,
        trialing: live?.status === 'trialing',
        slotsCheckout: live ? null : { trialDays: workspace?.stripe_addons_subscription_id ? 0 : TRIAL_DAYS },
        hasCustomer: !!liveCustomer,
        business: businessDetailsOf(liveCustomer),
    }
}

// A subscription set to end that is asked for a slot again runs on: its slots are already paid until
// the renewal. A machine size or storage on it was given back and stays given back, billed to nobody.
// One that carries nothing else waits: the caller adds the slot, then asks again.
export async function resumeLifetimeAddons(subscription: Stripe.Subscription): Promise<Stripe.Subscription> {
    if (!subscription.cancel_at_period_end) return subscription
    const givenBack = subscription.items.data.filter(item => machineSizeForPriceId(item.price?.id) || addonForPriceId(item.price?.id) === 'storage_pack')
    if (givenBack.length === subscription.items.data.length) return subscription
    return stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
        ...(givenBack.length > 0 ? { items: givenBack.map(item => ({ id: item.id, deleted: true })), proration_behavior: 'none' as const } : {}),
    })
}

// --- The machine of a lifetime workspace ---

export type LifetimeMachineSelection = { machineSize: MachineSize; storagePacks: number }

export type LifetimeMachineChange = { checkoutUrl: string | null; paymentClientSecret: string | null }

// Only the full lifetime plan buys a size, by the month, like its app slots: an AppSumo workspace and
// an organization's have no subscription to carry it.
async function requireLifetimeMachineBuyer(): Promise<{ workspaceId: number; addonsSubscriptionId: string | null }> {
    const workspaceId = await requireWorkspaceId()
    const { data: workspace } = await selectMaybeSingle(createServiceRoleClient(), 'workspaces', ['plan', 'organization_id', 'stripe_addons_subscription_id'] as const, { id: workspaceId })
    if (workspace?.plan !== LIFETIME_PLAN_SLUG || !arePaidAppsOffered(workspace)) throw new AppError('machineNotOffered')
    return { workspaceId, addonsSubscriptionId: workspace.stripe_addons_subscription_id }
}

function assertValidLifetimeMachine(selection: LifetimeMachineSelection): void {
    if (!isMachineSize(selection.machineSize)) throw new AppError('invalidMachineSize')
    if (!Number.isInteger(selection.storagePacks) || selection.storagePacks < 0 || selection.storagePacks > ADDON_MAX_QUANTITIES.storage_pack) throw new AppError('invalidAddonQuantity')
}

function machineLineItems({ machineSize, storagePacks }: LifetimeMachineSelection): { price: string; quantity: number }[] {
    return [
        ...(machineSize === INCLUDED_MACHINE_SIZE ? [] : [{ price: machinePriceId(machineSize, 'monthly'), quantity: 1 }]),
        ...(storagePacks > 0 ? [{ price: priceIdForAddon('storage_pack', 'monthly'), quantity: storagePacks }] : []),
    ]
}

// A larger size or more storage is billed today for the rest of the month, a smaller one lands at the
// renewal and is never refunded. Without a live subscription to put it on, the first purchase goes
// through Checkout, with no free trial: the trial comes with the first app slot only.
export async function changeLifetimeMachine(selection: LifetimeMachineSelection, requestId: string): Promise<LifetimeMachineChange> {
    assertValidLifetimeMachine(selection)
    const { workspaceId, addonsSubscriptionId } = await requireLifetimeMachineBuyer()
    const current = addonsSubscriptionId ? await stripe.subscriptions.retrieve(addonsSubscriptionId) : null
    const subscription = current && isSubscriptionEntitled(current.status) ? current : null

    if (!subscription) {
        const lineItems = machineLineItems(selection)
        if (lineItems.length === 0) return { checkoutUrl: null, paymentClientSecret: null }
        return { checkoutUrl: await createLifetimeMachineCheckout(lineItems, requestId), paymentClientSecret: null }
    }
    // Its trial bills nothing until it ends: a size bought during it would run for free until then.
    if (subscription.status === 'trialing') throw new AppError('lifetimeMachineDuringTrial')

    const target: LifetimeMachineTarget = { ...selection, givenBack: !!subscription.cancel_at_period_end }
    const { increases, decreases } = planItemChanges(subscription, lifetimeItemsTarget(subscription, target))

    // Stripe keeps at least one item: a subscription left with nothing to bill ends with its period,
    // everything on it still running until then.
    const kept = subscription.items.data.filter(item => !decreases.some(change => change.id === item.id && change.deleted)).length + increases.filter(change => !change.id).length
    if (kept === 0) {
        if (!subscription.cancel_at_period_end) await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })
        return { checkoutUrl: null, paymentClientSecret: null }
    }

    // The increases are billed first and alone, so nothing is given back for a payment that fails.
    // A later update carrying `items` would make Stripe drop a pending increase, so while the bank is
    // asked the rest waits in the pending update's metadata for finishPendingLifetimeMachineChange.
    const finishesLater = decreases.length > 0 || target.givenBack
    if (increases.length > 0) {
        const paymentClientSecret = await updateWithPayment(subscription.id, {
            items: increases,
            proration_behavior: 'always_invoice',
            ...(finishesLater ? { metadata: { [MACHINE_CHANGE_AFTER_PAYMENT_KEY]: JSON.stringify(target) } } : {}),
        })
        if (paymentClientSecret) return { checkoutUrl: null, paymentClientSecret }
    }
    const paid = increases.length > 0 ? await stripe.subscriptions.retrieve(subscription.id) : subscription
    await finishLifetimeMachineChange(paid, target, { clearAfterPayment: increases.length > 0 && finishesLater })
    return { checkoutUrl: null, paymentClientSecret: null }
}

const MACHINE_CHANGE_AFTER_PAYMENT_KEY = 'machine_change_after_payment'

// `givenBack`: the subscription was set to end, so every slot it carries was given back and is not
// revived by a size bought on it.
type LifetimeMachineTarget = LifetimeMachineSelection & { givenBack: boolean }

function lifetimeItemsTarget(subscription: Stripe.Subscription, target: LifetimeMachineTarget): { quantities: AddonQuantities; machineSize: MachineSize } {
    const { quantities } = quantitiesFromItems(subscription.items.data)
    return { quantities: { ...(target.givenBack ? ZERO_QUANTITIES : quantities), storage_pack: target.storagePacks }, machineSize: target.machineSize }
}

// The rest of a change once its increase is paid: the decreases, billed to nobody, and a subscription
// set to end running on. Recomputed from the subscription it is given, so a replay finds nothing left.
async function finishLifetimeMachineChange(subscription: Stripe.Subscription, target: LifetimeMachineTarget, { clearAfterPayment }: { clearAfterPayment: boolean }): Promise<void> {
    const { decreases } = planItemChanges(subscription, lifetimeItemsTarget(subscription, target))
    const resume = target.givenBack && subscription.cancel_at_period_end
    if (decreases.length === 0 && !resume && !clearAfterPayment) return
    await stripe.subscriptions.update(subscription.id, {
        ...(decreases.length > 0 ? { items: decreases } : {}),
        ...(resume ? { cancel_at_period_end: false } : {}),
        proration_behavior: 'none',
        ...(clearAfterPayment ? { metadata: { [MACHINE_CHANGE_AFTER_PAYMENT_KEY]: '' } } : {}),
    })
}

function parseLifetimeMachineTarget(raw: string | undefined): LifetimeMachineTarget | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as Partial<LifetimeMachineTarget>
        const target = { machineSize: parsed.machineSize as MachineSize, storagePacks: Number(parsed.storagePacks), givenBack: parsed.givenBack === true }
        assertValidLifetimeMachine(target)
        return target
    } catch {
        return null
    }
}

// `customer.subscription.pending_update_applied` on an add-ons subscription: the size the bank held is
// paid, so the rest of its change follows. Read again rather than taken from the event.
export async function finishPendingLifetimeMachineChange(subscription: Stripe.Subscription): Promise<void> {
    if (!isLifetimeAddonsSubscription(subscription)) return
    const live = await stripe.subscriptions.retrieve(subscription.id)
    const target = parseLifetimeMachineTarget(live.metadata?.[MACHINE_CHANGE_AFTER_PAYMENT_KEY])
    if (!target) return
    await finishLifetimeMachineChange(live, target, { clearAfterPayment: true })
}

async function createLifetimeMachineCheckout(lineItems: { price: string; quantity: number }[], requestId: string): Promise<string> {
    const { workspaceId, customerId } = await ensureStripeCustomer()
    const origin = await getAppOrigin()
    const metadata: Stripe.MetadataParam = { kind: LIFETIME_ADDONS_KIND, workspace_id: String(workspaceId) }

    const checkout = await stripe.checkout.sessions.create(
        {
            mode: 'subscription',
            customer: customerId,
            line_items: lineItems,
            currency: PLAN_CURRENCY,
            subscription_data: { metadata },
            payment_method_collection: 'always',
            payment_method_types: PLAN_PAYMENT_METHOD_TYPES,
            automatic_tax: { enabled: true },
            tax_id_collection: { enabled: true },
            customer_update: { address: 'auto', name: 'auto' },
            ...LIFETIME_MACHINE_CONSENT,
            metadata,
            // {CHECKOUT_SESSION_ID} is a Stripe literal, not a template hole to interpolate.
            success_url: `${origin}/?billing=1&${MACHINE_CHECKOUT_PARAM}={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/?billing=1`,
        },
        { idempotencyKey: `lifetime-machine-${requestId}` },
    )
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL')
    return checkout.url
}

