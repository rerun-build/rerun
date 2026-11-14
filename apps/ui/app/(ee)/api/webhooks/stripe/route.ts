import {
    adoptCheckoutPaymentMethodAsDefault,
    applyCardSetupSession,
    applySubscriptionToWorkspace,
    finishPendingPlanChange,
    markSubscriptionCanceled,
    markSubscriptionPastDue,
    PLAN_CARD_SETUP_KIND,
    stampFirstPlanPayment,
} from '@/ee/services/billing.service'
import { reportPlanInvoicePaid, reportSubscriptionCancelRequested } from '@/ee/services/billing-analytics.service'
import { markPaymentMethodAdded } from '@/app/api/_services/getting-started.service'
import { enforceTrialCardClaim } from '@/ee/services/trial-card.service'
import {
    applyTemplateSubscription,
    recordTemplatePurchase,
    recordTemplateRenewal,
    refundTemplatePurchase,
    revokeTemplateSubscription,
} from '@/ee/services/template-purchase.service'
import { isTemplateCheckoutSession, isTemplateSubscription } from '@/ee/lib/billing/marketplace'
import { isCreditCheckoutSession, recordCreditCheckoutSession, recordCreditInvoice, refundCreditPurchase } from '@/ee/services/credit-purchase.service'
import { stripe, subscriptionOfInvoice } from '@/ee/lib/billing/stripe'
import type Stripe from 'stripe'
import { claimStripeEvent, markStripeEventProcessed, releaseStripeEvent, unclaimedResponse } from './idempotency'

// Stripe webhook. Keeps the workspace's subscription snapshot in sync after payment events, and
// records marketplace purchases. The signature is verified against STRIPE_WEBHOOK_SECRET using the
// raw request body, so this route must read req.text() (never req.json()).
//
// A workspace's plan and its template subscriptions live on the same Stripe customer and arrive
// through the same `customer.subscription.*` events, so every subscription case routes on
// `isTemplateSubscription` before touching anything. The billing service repeats that check,
// deliberately: a purchase must never be able to rewrite a workspace's billing state.
export async function POST(req: Request) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) return Response.json({ error: 'STRIPE_WEBHOOK_SECRET is not configured' }, { status: 500 })

    const sig = req.headers.get('stripe-signature')
    if (!sig) return Response.json({ error: 'Missing signature' }, { status: 400 })

    const raw = await req.text()
    let event: Stripe.Event
    try {
        event = await stripe.webhooks.constructEventAsync(raw, sig, secret)
    } catch (err) {
        return Response.json({ error: `Invalid signature: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 400 })
    }

    const claim = await claimStripeEvent(event)
    if (claim !== 'claimed') return unclaimedResponse(claim)

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object
                if (isTemplateCheckoutSession(session)) {
                    if (session.payment_status === 'paid') await recordTemplatePurchase(session)
                    break
                }
                if (isCreditCheckoutSession(session)) {
                    await recordCreditCheckoutSession(session)
                    break
                }
                // Setup mode carries no `session.subscription`: it is the card collected on a trial
                // started without one, and the browser's confirmation may already have applied it.
                // Here for the tab closed before that confirmation ran.
                if (session.mode === 'setup') {
                    if (session.metadata?.kind === PLAN_CARD_SETUP_KIND) {
                        await applyCardSetupSession(session)
                        const workspaceId = Number(session.metadata.workspace_id)
                        if (Number.isInteger(workspaceId) && workspaceId > 0) await markPaymentMethodAdded(workspaceId)
                    }
                    break
                }
                if (session.subscription) {
                    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
                    const subscription = await stripe.subscriptions.retrieve(subId)
                    // Before the sync, never after: it settles the trial so the workspace is never
                    // written as `trialing` on a card that has already spent its one free trial.
                    // Null means the card had, and the subscription was cancelled: there is nothing
                    // left to sync and no card to adopt.
                    const settled = await enforceTrialCardClaim(subscription, session)
                    if (!settled) break
                    await applySubscriptionToWorkspace(settled)
                    await adoptCheckoutPaymentMethodAsDefault(session, settled)
                }
                break
            }
            // Stripe orders neither this event nor the checkout one, so the card check hangs off
            // both. Whichever arrives first and can resolve a card does the work; the other finds
            // the subscription already settled and stands down.
            case 'customer.subscription.created': {
                if (isTemplateSubscription(event.data.object)) {
                    await applyTemplateSubscription(event.data.object)
                    break
                }
                const settled = await enforceTrialCardClaim(event.data.object)
                if (settled) await applySubscriptionToWorkspace(settled)
                break
            }
            case 'customer.subscription.updated': {
                const subscription = event.data.object
                if (isTemplateSubscription(subscription)) {
                    await applyTemplateSubscription(subscription)
                    break
                }
                // An update is a lifecycle event, not a purchase: it may refresh the workspace's own
                // subscription, never replace it. Anything else on the customer is a leftover whose
                // retries and cancellation must not touch a workspace that is paid and current.
                await applySubscriptionToWorkspace(subscription, { adopt: false })
                // A portal cancel schedules the end without deleting anything: the only trace is
                // cancel_at_period_end flipping to true on this event.
                if (event.data.previous_attributes?.cancel_at_period_end === false && subscription.cancel_at_period_end) {
                    await reportSubscriptionCancelRequested(subscription, event.id)
                }
                break
            }
            case 'customer.subscription.deleted':
                if (isTemplateSubscription(event.data.object)) await revokeTemplateSubscription(event.data.object)
                else await markSubscriptionCanceled(event.data.object)
                break
            // The bank confirmed a plan increase Stripe had held: the rest of that change (its
            // decreases, its switch at renewal) was waiting for this. The `updated` event alongside
            // refreshes the workspace as usual.
            case 'customer.subscription.pending_update_applied':
                if (!isTemplateSubscription(event.data.object)) await finishPendingPlanChange(event.data.object)
                break
            // The ledger line of every template subscription cycle, first invoice included: a
            // checkout only ever fires once, renewals only show up here.
            // Each step runs whatever the others do: a template ledger that keeps failing must not
            // hold back the plan's own stamp through every retry. All of them are safe to replay.
            case 'invoice.paid': {
                const invoice = event.data.object
                await runEach([
                    () => recordCreditInvoice(invoice),
                    () => recordTemplateRenewal(invoice),
                    () => reportPlanInvoicePaid(invoice),
                    // The only place a real charge is observed, and therefore the only place the
                    // "this workspace has paid" guardrail can be stamped.
                    () => stampFirstPlanPayment(invoice),
                ])
                break
            }
            case 'invoice.payment_failed': {
                const subscription = await subscriptionOfInvoice(event.data.object)
                if (!subscription) break
                if (isTemplateSubscription(subscription)) await applyTemplateSubscription(subscription)
                else await markSubscriptionPastDue(subscription, event.data.object)
                break
            }
            case 'charge.refunded':
                await runEach([() => refundTemplatePurchase(event.data.object), () => refundCreditPurchase(event.data.object)])
                break
        }
        await markStripeEventProcessed(event.id)
    } catch (err) {
        // Release the claim, then log and 500 so Stripe retries; never swallow into a 200.
        await releaseStripeEvent(event.id)
        console.error('[stripe webhook] handler failed', event.type, err)
        return Response.json({ error: 'Handler failed' }, { status: 500 })
    }

    return Response.json({ received: true }, { status: 200 })
}

// In order, every step whatever happened to the ones before; the first failure is rethrown once
// they all ran, so Stripe still retries the event.
async function runEach(steps: (() => Promise<unknown>)[]): Promise<void> {
    const failures: unknown[] = []
    for (const step of steps) {
        try {
            await step()
        } catch (err) {
            failures.push(err)
        }
    }
    if (failures.length) throw failures[0]
}
