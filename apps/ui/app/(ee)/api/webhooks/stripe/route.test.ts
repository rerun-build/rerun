import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    adoptCheckoutPaymentMethodAsDefault,
    applyCardSetupSession,
    applySubscriptionToWorkspace,
    finishPendingPlanChange,
    markSubscriptionCanceled,
    markSubscriptionPastDue,
    stampFirstPlanPayment,
} from '@/ee/services/billing.service'
import { reportPlanInvoicePaid, reportSubscriptionCancelRequested } from '@/ee/services/billing-analytics.service'
import { markPaymentMethodAdded } from '@/app/api/_services/getting-started.service'
import { enforceTrialCardClaim } from '@/ee/services/trial-card.service'
import { applyTemplateSubscription, recordTemplatePurchase, recordTemplateRenewal, refundTemplatePurchase, revokeTemplateSubscription } from '@/ee/services/template-purchase.service'
import { recordCreditCheckoutSession, recordCreditInvoice, refundCreditPurchase } from '@/ee/services/credit-purchase.service'
import { stripe, subscriptionOfInvoice } from '@/ee/lib/billing/stripe'
import { signedStripeRequest, TEST_WEBHOOK_SECRET } from '@/ee/test/stripe-fake'
import { claimStripeEvent, markStripeEventProcessed, releaseStripeEvent } from './idempotency'
import { POST } from './route'

vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()),
    stripe: (await import('@/ee/test/stripe-fake')).fakeStripe(),
    subscriptionOfInvoice: vi.fn(),
}))
vi.mock('@/ee/services/billing.service', () => ({
    PLAN_CARD_SETUP_KIND: 'plan_card_setup',
    adoptCheckoutPaymentMethodAsDefault: vi.fn(),
    applyCardSetupSession: vi.fn(),
    applySubscriptionToWorkspace: vi.fn(),
    finishPendingPlanChange: vi.fn(),
    markSubscriptionCanceled: vi.fn(),
    markSubscriptionPastDue: vi.fn(),
    stampFirstPlanPayment: vi.fn(),
}))
vi.mock('@/ee/services/billing-analytics.service', () => ({ reportPlanInvoicePaid: vi.fn(), reportSubscriptionCancelRequested: vi.fn() }))
vi.mock('@/app/api/_services/getting-started.service', () => ({ markPaymentMethodAdded: vi.fn() }))
vi.mock('@/ee/services/trial-card.service', () => ({ enforceTrialCardClaim: vi.fn() }))
vi.mock('@/ee/services/template-purchase.service', () => ({
    applyTemplateSubscription: vi.fn(),
    recordTemplatePurchase: vi.fn(),
    recordTemplateRenewal: vi.fn(),
    refundTemplatePurchase: vi.fn(),
    revokeTemplateSubscription: vi.fn(),
}))
vi.mock('@/ee/services/credit-purchase.service', async importOriginal => ({
    isCreditCheckoutSession: (await importOriginal<typeof import('@/ee/services/credit-purchase.service')>()).isCreditCheckoutSession,
    recordCreditCheckoutSession: vi.fn(),
    recordCreditInvoice: vi.fn(),
    refundCreditPurchase: vi.fn(),
}))
vi.mock('./idempotency', async importOriginal => ({ ...(await importOriginal<typeof import('./idempotency')>()), claimStripeEvent: vi.fn(), markStripeEventProcessed: vi.fn(), releaseStripeEvent: vi.fn() }))

const planSubscription = { id: 'sub_plan', object: 'subscription', metadata: { plan: 'base', workspace_id: '7' }, items: { data: [{ price: { id: 'price_base' } }] }, cancel_at_period_end: false }
const templateSubscription = { id: 'sub_tpl', object: 'subscription', metadata: { kind: 'template_purchase' }, items: { data: [{ price: { id: 'price_template' } }] } }

function deliver(type: string, object: object, extra: { previous_attributes?: object; account?: string } = {}) {
    const { previous_attributes, ...rest } = extra
    return POST(signedStripeRequest({ id: 'evt_1', type, data: { object, ...(previous_attributes ? { previous_attributes } : {}) }, ...rest }))
}

beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET)
    vi.mocked(claimStripeEvent).mockResolvedValue('claimed')
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('stripe webhook verification', () => {
    it('answers 500 when the webhook secret is not configured', async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
        const res = await deliver('invoice.paid', {})
        expect(res.status).toBe(500)
        expect(claimStripeEvent).not.toHaveBeenCalled()
    })

    it('refuses a request without a stripe-signature header', async () => {
        const res = await POST(new Request('https://rerun.test/api/webhooks/stripe', { method: 'POST', body: '{}' }))
        expect(res.status).toBe(400)
    })

    it('refuses a request signed with another secret', async () => {
        const res = await POST(signedStripeRequest({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } }, { secret: 'whsec_other' }))
        expect(res.status).toBe(400)
        expect(claimStripeEvent).not.toHaveBeenCalled()
    })

    it('drops a duplicate delivery without running any handler', async () => {
        vi.mocked(claimStripeEvent).mockResolvedValue('processed')
        const res = await deliver('charge.refunded', { id: 'ch_1' })
        expect(res.status).toBe(200)
        await expect(res.json()).resolves.toEqual({ received: true, duplicate: true })
        expect(refundTemplatePurchase).not.toHaveBeenCalled()
        expect(markStripeEventProcessed).not.toHaveBeenCalled()
    })

    it('answers 409 to a delivery that arrives while another one runs the event, so Stripe retries it later', async () => {
        vi.mocked(claimStripeEvent).mockResolvedValue('in_flight')
        const res = await deliver('charge.refunded', { id: 'ch_1' })
        expect(res.status).toBe(409)
        expect(refundTemplatePurchase).not.toHaveBeenCalled()
        expect(releaseStripeEvent).not.toHaveBeenCalled()
    })

    it('releases the claim and answers 500 when a handler throws, so Stripe retries', async () => {
        vi.mocked(refundTemplatePurchase).mockRejectedValue(new Error('db down'))
        const res = await deliver('charge.refunded', { id: 'ch_1' })
        expect(res.status).toBe(500)
        expect(releaseStripeEvent).toHaveBeenCalledWith('evt_1')
        expect(markStripeEventProcessed).not.toHaveBeenCalled()
    })

    it('marks an event it does not handle as processed', async () => {
        const res = await deliver('customer.created', { id: 'cus_1' })
        expect(res.status).toBe(200)
        expect(markStripeEventProcessed).toHaveBeenCalledWith('evt_1')
    })
})

describe('checkout.session.completed', () => {
    it('records a template purchase', async () => {
        const session = { id: 'cs_1', mode: 'payment', payment_status: 'paid', metadata: { kind: 'template_purchase' } }
        await deliver('checkout.session.completed', session)
        expect(recordTemplatePurchase).toHaveBeenCalledWith(expect.objectContaining({ id: 'cs_1' }))
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    })

    it('refuses to grant a template purchase whose session payment_status is unpaid', async () => {
        const session = { id: 'cs_1', mode: 'payment', status: 'complete', payment_status: 'unpaid', metadata: { kind: 'template_purchase' } }
        const res = await deliver('checkout.session.completed', session)
        expect(res.status).toBe(200)
        expect(recordTemplatePurchase).not.toHaveBeenCalled()
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
        expect(applySubscriptionToWorkspace).not.toHaveBeenCalled()
    })

    it('grants the Rerun credit bought on a Checkout page, without touching the plan', async () => {
        const session = { id: 'cs_1', mode: 'payment', payment_status: 'paid', metadata: { kind: 'credit_purchase', workspace_id: '7', packs: '2' } }
        await deliver('checkout.session.completed', session)
        expect(recordCreditCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'cs_1' }))
        expect(recordTemplatePurchase).not.toHaveBeenCalled()
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    })

    it('applies a plan card setup and marks the payment method added', async () => {
        await deliver('checkout.session.completed', { id: 'cs_1', mode: 'setup', metadata: { kind: 'plan_card_setup', workspace_id: '7' } })
        expect(applyCardSetupSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'cs_1' }))
        expect(markPaymentMethodAdded).toHaveBeenCalledWith(7)
    })

    it('skips the getting-started step when the setup session carries no usable workspace id', async () => {
        for (const workspace_id of ['abc', '0', '-3', '1.5']) {
            await deliver('checkout.session.completed', { id: 'cs_1', mode: 'setup', metadata: { kind: 'plan_card_setup', workspace_id } })
        }
        expect(applyCardSetupSession).toHaveBeenCalledTimes(4)
        expect(markPaymentMethodAdded).not.toHaveBeenCalled()
    })

    it('ignores a setup session that is not a plan card setup', async () => {
        const res = await deliver('checkout.session.completed', { id: 'cs_1', mode: 'setup', metadata: { kind: 'other' }, subscription: 'sub_plan' })
        expect(res.status).toBe(200)
        expect(applyCardSetupSession).not.toHaveBeenCalled()
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    })

    it('settles the trial card, syncs the plan and adopts the card, in that order', async () => {
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(planSubscription as never)
        const settled = { ...planSubscription, status: 'active' }
        vi.mocked(enforceTrialCardClaim).mockResolvedValue(settled as never)

        await deliver('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_plan', metadata: {} })

        expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_plan')
        expect(enforceTrialCardClaim).toHaveBeenCalledWith(planSubscription, expect.objectContaining({ id: 'cs_1' }))
        expect(applySubscriptionToWorkspace).toHaveBeenCalledWith(settled)
        expect(adoptCheckoutPaymentMethodAsDefault).toHaveBeenCalledWith(expect.objectContaining({ id: 'cs_1' }), settled)
        const order = [enforceTrialCardClaim, applySubscriptionToWorkspace, adoptCheckoutPaymentMethodAsDefault].map(fn => vi.mocked(fn).mock.invocationCallOrder[0])
        expect(order).toEqual([...order].sort((a, b) => a - b))
    })

    it('stops when the trial card claim cancelled the subscription', async () => {
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(planSubscription as never)
        vi.mocked(enforceTrialCardClaim).mockResolvedValue(null)

        const res = await deliver('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: { id: 'sub_plan' }, metadata: {} })

        expect(res.status).toBe(200)
        expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_plan')
        expect(applySubscriptionToWorkspace).not.toHaveBeenCalled()
        expect(adoptCheckoutPaymentMethodAsDefault).not.toHaveBeenCalled()
    })
})

describe('customer.subscription.*', () => {
    it('hands a created template subscription to the marketplace', async () => {
        await deliver('customer.subscription.created', templateSubscription)
        expect(applyTemplateSubscription).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_tpl' }))
        expect(enforceTrialCardClaim).not.toHaveBeenCalled()
        expect(applySubscriptionToWorkspace).not.toHaveBeenCalled()
    })

    it('settles the trial card before syncing a created plan subscription', async () => {
        vi.mocked(enforceTrialCardClaim).mockResolvedValue({ id: 'sub_settled' } as never)
        await deliver('customer.subscription.created', planSubscription)
        expect(enforceTrialCardClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_plan' }))
        expect(applySubscriptionToWorkspace).toHaveBeenCalledWith({ id: 'sub_settled' })
    })

    it('syncs nothing when the created plan subscription was refused a trial', async () => {
        vi.mocked(enforceTrialCardClaim).mockResolvedValue(null)
        await deliver('customer.subscription.created', planSubscription)
        expect(applySubscriptionToWorkspace).not.toHaveBeenCalled()
    })

    it('hands an updated template subscription to the marketplace', async () => {
        await deliver('customer.subscription.updated', templateSubscription)
        expect(applyTemplateSubscription).toHaveBeenCalledOnce()
        expect(applySubscriptionToWorkspace).not.toHaveBeenCalled()
    })

    it('refreshes an updated plan subscription without letting it take over the workspace', async () => {
        await deliver('customer.subscription.updated', planSubscription)
        expect(applySubscriptionToWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_plan' }), { adopt: false })
        expect(reportSubscriptionCancelRequested).not.toHaveBeenCalled()
    })

    it('reports a cancellation requested from the portal', async () => {
        await deliver('customer.subscription.updated', { ...planSubscription, cancel_at_period_end: true }, { previous_attributes: { cancel_at_period_end: false } })
        expect(reportSubscriptionCancelRequested).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_plan' }), 'evt_1')
    })

    it('reports no cancellation when cancel_at_period_end did not just flip', async () => {
        await deliver('customer.subscription.updated', { ...planSubscription, cancel_at_period_end: true }, { previous_attributes: { status: 'trialing' } })
        expect(reportSubscriptionCancelRequested).not.toHaveBeenCalled()
    })

    it('revokes a deleted template subscription', async () => {
        await deliver('customer.subscription.deleted', templateSubscription)
        expect(revokeTemplateSubscription).toHaveBeenCalledOnce()
        expect(markSubscriptionCanceled).not.toHaveBeenCalled()
    })

    it('cancels the workspace plan when its subscription is deleted', async () => {
        await deliver('customer.subscription.deleted', planSubscription)
        expect(markSubscriptionCanceled).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_plan' }))
        expect(revokeTemplateSubscription).not.toHaveBeenCalled()
    })

    it('finishes the plan change the bank held once its pending update is applied', async () => {
        await deliver('customer.subscription.pending_update_applied', planSubscription)
        expect(finishPendingPlanChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub_plan' }))
    })

    it('finishes nothing for an applied pending update on a template subscription', async () => {
        await deliver('customer.subscription.pending_update_applied', templateSubscription)
        expect(finishPendingPlanChange).not.toHaveBeenCalled()
    })
})

describe('invoice.*', () => {
    it('records a credit purchase, the renewal, reports the payment and stamps the first payment, in that order', async () => {
        await deliver('invoice.paid', { id: 'in_1' })
        const fns = [recordCreditInvoice, recordTemplateRenewal, reportPlanInvoicePaid, stampFirstPlanPayment]
        for (const fn of fns) expect(fn).toHaveBeenCalledWith(expect.objectContaining({ id: 'in_1' }))
        const order = fns.map(fn => vi.mocked(fn).mock.invocationCallOrder[0])
        expect(order).toEqual([...order].sort((a, b) => a - b))
    })

    it('stamps the first plan payment even when recording a template renewal throws, and still fails the delivery', async () => {
        vi.mocked(recordTemplateRenewal).mockRejectedValue(new Error('ledger down'))

        const response = await deliver('invoice.paid', { id: 'in_1' })

        expect(stampFirstPlanPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'in_1' }))
        expect(reportPlanInvoicePaid).toHaveBeenCalledWith(expect.objectContaining({ id: 'in_1' }))
        expect(response.status).toBe(500)
        expect(releaseStripeEvent).toHaveBeenCalledWith('evt_1')
        expect(markStripeEventProcessed).not.toHaveBeenCalled()
    })

    it('refreshes a template subscription whose invoice failed', async () => {
        vi.mocked(subscriptionOfInvoice).mockResolvedValue(templateSubscription as never)
        await deliver('invoice.payment_failed', { id: 'in_1' })
        expect(applyTemplateSubscription).toHaveBeenCalledWith(templateSubscription)
        expect(markSubscriptionPastDue).not.toHaveBeenCalled()
    })

    it('marks the plan past_due when its invoice failed', async () => {
        vi.mocked(subscriptionOfInvoice).mockResolvedValue(planSubscription as never)
        await deliver('invoice.payment_failed', { id: 'in_1' })
        expect(markSubscriptionPastDue).toHaveBeenCalledWith(planSubscription, expect.objectContaining({ id: 'in_1' }))
    })

    it('does nothing for a failed invoice without a subscription', async () => {
        vi.mocked(subscriptionOfInvoice).mockResolvedValue(null)
        const res = await deliver('invoice.payment_failed', { id: 'in_1' })
        expect(res.status).toBe(200)
        expect(markSubscriptionPastDue).not.toHaveBeenCalled()
        expect(applyTemplateSubscription).not.toHaveBeenCalled()
    })
})

describe('charge.refunded', () => {
    it('refunds the template purchase', async () => {
        await deliver('charge.refunded', { id: 'ch_1' })
        expect(refundTemplatePurchase).toHaveBeenCalledWith(expect.objectContaining({ id: 'ch_1' }))
        expect(markStripeEventProcessed).toHaveBeenCalledWith('evt_1')
    })

    it('takes back the Rerun credit of a refunded purchase', async () => {
        await deliver('charge.refunded', { id: 'ch_1' })
        expect(refundCreditPurchase).toHaveBeenCalledWith(expect.objectContaining({ id: 'ch_1' }))
    })
})
