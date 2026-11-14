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
import { stripe, subscriptionOfInvoice } from '@/ee/lib/billing/stripe'
import type Stripe from 'stripe'
import { claimStripeEvent, markStripeEventProcessed, releaseStripeEvent, unclaimedResponse } from './idempotency'

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
                    const settled = await enforceTrialCardClaim(subscription, session)
                    if (!settled) break
                    await applySubscriptionToWorkspace(settled)
                    await adoptCheckoutPaymentMethodAsDefault(session, settled)
                }
                break
            }
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
                await applySubscriptionToWorkspace(subscription, { adopt: false })
                if (event.data.previous_attributes?.cancel_at_period_end === false && subscription.cancel_at_period_end) {
                    await reportSubscriptionCancelRequested(subscription, event.id)
                }
                break
            }
            case 'customer.subscription.deleted':
                if (isTemplateSubscription(event.data.object)) await revokeTemplateSubscription(event.data.object)
                else await markSubscriptionCanceled(event.data.object)
                break
            case 'customer.subscription.pending_update_applied':
                if (!isTemplateSubscription(event.data.object)) await finishPendingPlanChange(event.data.object)
                break
            case 'invoice.paid': {
                const invoice = event.data.object
                await runEach([
                    () => recordTemplateRenewal(invoice),
                    () => reportPlanInvoicePaid(invoice),
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
                await refundTemplatePurchase(event.data.object)
                break
        }
        await markStripeEventProcessed(event.id)
    } catch (err) {
        await releaseStripeEvent(event.id)
        console.error('[stripe webhook] handler failed', event.type, err)
        return Response.json({ error: 'Handler failed' }, { status: 500 })
    }

    return Response.json({ received: true }, { status: 200 })
}

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
