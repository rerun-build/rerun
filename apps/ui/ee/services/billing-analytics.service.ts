import { BASE_PLAN_SLUG, perMonthCents } from '@/ee/lib/billing/plans'
import { CANCEL_COMEBACK_METADATA_KEY, CANCEL_REASON_CHECK_METADATA_KEY } from '@/ee/lib/billing/cancel-flow'
import { isTemplateSubscription, stripeTimestampIso } from '@/ee/lib/billing/marketplace'
import { intervalOfItems, legacyBaseDiscountCents, priceArmOfItems, quantitiesFromItems, subscriptionOfInvoice } from '@/ee/lib/billing/stripe'
import { resolveWorkspaceMemberEmail, resolveWorkspaceOwner, type WorkspaceOwner } from '@/app/api/_services/workspace-owner.service'
import { captureServer, deterministicUuid } from '@rerun/analytics/server'
import type { BillingPeriod, SubscriptionLifecycleProps } from '@rerun/analytics'
import { foremanClientSchema, type ForemanClient } from '@rerun/contracts'
import type Stripe from 'stripe'
import { findWorkspaceId } from './billing.service'

export { resolveWorkspaceMemberEmail, resolveWorkspaceOwner }

function trialOrigin(origin: string | undefined): ForemanClient {
    return foremanClientSchema.catch('web').parse(origin)
}

function lifecycleProps(subscription: Stripe.Subscription, workspaceId: number, owner: WorkspaceOwner): SubscriptionLifecycleProps {
    const items = subscription.items?.data ?? []
    const { quantities } = quantitiesFromItems(items)
    const interval = intervalOfItems(items)
    const mrr = (perMonthCents(quantities, interval, priceArmOfItems(items)) - legacyBaseDiscountCents(items)) / 100
    const billing_period: BillingPeriod = interval === 'yearly' ? 'annual' : 'monthly'
    return {
        plan: BASE_PLAN_SLUG,
        workspace_id: workspaceId,
        user_id: owner.userId,
        stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripe_subscription_id: subscription.id,
        addons: quantities,
        mrr,
        currency: subscription.currency,
        billing_period,
        trial_start: stripeTimestampIso(subscription.trial_start) ?? undefined,
        trial_end: stripeTimestampIso(subscription.trial_end) ?? undefined,
    }
}

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid'])

export async function reportSubscriptionTransition(subscription: Stripe.Subscription, workspaceId: number, previousStatus: string | null): Promise<void> {
    try {
        const wasLive = LIVE_STATUSES.has(previousStatus ?? '')
        const event =
            !wasLive && subscription.status === 'trialing'
                ? ('trial_started' as const)
                : !wasLive && subscription.status === 'active'
                  ? ('subscription_started' as const)
                  : null
        if (!event) return

        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return

        const props = lifecycleProps(subscription, workspaceId, owner)
        const uuid = deterministicUuid(`${event}:${subscription.id}`)
        if (event === 'trial_started') await captureServer(owner.email, event, { ...props, trial_type: subscription.trial_settings?.end_behavior?.missing_payment_method === 'cancel' ? 'no_card_5d' : 'card_required_5d', origin: trialOrigin(subscription.metadata?.origin) }, { uuid })
        else await captureServer(owner.email, event, props, { uuid })
    } catch (err) {
        console.error('[billing analytics] subscription transition capture failed', err)
    }
}

export async function reportTrialConverted(subscription: Stripe.Subscription, workspaceId: number): Promise<void> {
    try {
        if (!subscription.trial_end) return
        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return
        await captureServer(owner.email, 'trial_converted', lifecycleProps(subscription, workspaceId, owner), {
            uuid: deterministicUuid(`trial_converted:${subscription.id}`),
        })
    } catch (err) {
        console.error('[billing analytics] trial conversion capture failed', err)
    }
}

function cancellationFeedbackProps(subscription: Stripe.Subscription) {
    return {
        cancellation_reason: subscription.cancellation_details?.reason ?? undefined,
        cancellation_feedback: subscription.cancellation_details?.feedback ?? undefined,
        cancellation_comment: subscription.cancellation_details?.comment ?? undefined,
    }
}

export async function reportSubscriptionCancelRequested(subscription: Stripe.Subscription, eventId: string): Promise<void> {
    try {
        if (isTemplateSubscription(subscription)) return
        const workspaceId = await findWorkspaceId(subscription)
        if (!workspaceId) return
        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return
        await captureServer(
            owner.email,
            'subscription_cancel_requested',
            {
                ...lifecycleProps(subscription, workspaceId, owner),
                ...cancellationFeedbackProps(subscription),
                cancel_at: stripeTimestampIso(subscription.cancel_at) ?? undefined,
                cancel_comeback: subscription.metadata?.[CANCEL_COMEBACK_METADATA_KEY] || undefined,
                cancel_reason_check: subscription.metadata?.[CANCEL_REASON_CHECK_METADATA_KEY] || undefined,
            },
            { uuid: deterministicUuid(`subscription_cancel_requested:${eventId}`) },
        )
    } catch (err) {
        console.error('[billing analytics] cancel request capture failed', err)
    }
}

export async function reportSubscriptionCancelled(subscription: Stripe.Subscription, workspaceId: number): Promise<void> {
    try {
        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return
        await captureServer(
            owner.email,
            'subscription_cancelled',
            { ...lifecycleProps(subscription, workspaceId, owner), ...cancellationFeedbackProps(subscription) },
            { uuid: deterministicUuid(`subscription_cancelled:${subscription.id}`) },
        )
    } catch (err) {
        console.error('[billing analytics] cancellation capture failed', err)
    }
}

export async function reportTrialPaymentFailed(subscription: Stripe.Subscription, workspaceId: number, invoice: Stripe.Invoice): Promise<void> {
    try {
        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return
        await captureServer(
            owner.email,
            'trial_payment_failed',
            { ...lifecycleProps(subscription, workspaceId, owner), invoice_id: invoice.id ?? '', amount_due: invoice.amount_due / 100 },
            { uuid: deterministicUuid(`trial_payment_failed:${invoice.id}`) },
        )
    } catch (err) {
        console.error('[billing analytics] trial payment failure capture failed', err)
    }
}

export async function reportTrialSkippedForCardReuse(subscription: Stripe.Subscription, workspaceId: number): Promise<void> {
    try {
        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return
        await captureServer(owner.email, 'trial_skipped_card_reused', lifecycleProps(subscription, workspaceId, owner), {
            uuid: deterministicUuid(`trial_skipped_card_reused:${subscription.id}`),
        })
    } catch (err) {
        console.error('[billing analytics] skipped trial capture failed', err)
    }
}

export async function reportPlanInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    try {
        if (!invoice.amount_paid) return
        const subscription = await subscriptionOfInvoice(invoice)
        if (!subscription || isTemplateSubscription(subscription)) return
        if (!quantitiesFromItems(subscription.items?.data ?? []).hasBase) return
        const workspaceId = await findWorkspaceId(subscription)
        if (!workspaceId) return
        const owner = await resolveWorkspaceOwner(workspaceId)
        if (!owner) return
        await captureServer(
            owner.email,
            'invoice_paid',
            { ...lifecycleProps(subscription, workspaceId, owner), invoice_id: invoice.id ?? '', amount_paid: invoice.amount_paid / 100, billing_reason: invoice.billing_reason ?? undefined },
            { uuid: deterministicUuid(`invoice_paid:${invoice.id}`) },
        )
    } catch (err) {
        console.error('[billing analytics] invoice capture failed', err)
    }
}
