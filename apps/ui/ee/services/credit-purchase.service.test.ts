import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'
import { assertPaymentAwaitsConfirmation, ensureStripeCustomer } from './billing.service'
import { abandonCreditInvoice, buyCredit, confirmCreditCheckout, quoteCreditPurchase, recordCreditCheckoutSession, recordCreditInvoice, refundCreditPurchase, settleCreditInvoice } from './credit-purchase.service'

vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({ ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()), stripe: (await import('@/ee/test/stripe-fake')).fakeStripe() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({ requireWorkspaceId: vi.fn() }))
vi.mock('@/lib/app-origin', () => ({ getAppOrigin: vi.fn().mockResolvedValue('https://app.rerun.test') }))
vi.mock('./billing.service', async importOriginal => ({
    savedCard: (await importOriginal<typeof import('./billing.service')>()).savedCard,
    ensureStripeCustomer: vi.fn(),
    assertPaymentAwaitsConfirmation: vi.fn(),
}))

const WORKSPACE_ID = 42
const CARD = { id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } }
const METADATA = { kind: 'credit_purchase', workspace_id: '42', packs: '2' }

let workspace: { stripe_customer_id: string | null; stripe_subscription_id: string | null }
let purchase: { micros: number } | null
let db: FakeSupabase

function customer(overrides: Record<string, unknown> = {}) {
    return { id: 'cus_1', deleted: false, address: { country: 'FR' }, invoice_settings: { default_payment_method: CARD }, ...overrides }
}

function grants() {
    return db.chainsOn('rpc:grant_rerun_credit_purchase').map(chain => chain[0].args[1])
}

beforeEach(() => {
    vi.clearAllMocks()
    workspace = { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }
    purchase = { micros: 20_000_000 }
    db = fakeSupabase(table => {
        if (table === 'workspaces') return { data: workspace }
        if (table === 'rerun_credit_purchases') return { data: purchase }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(requireWorkspaceId).mockResolvedValue(WORKSPACE_ID)
    vi.mocked(ensureStripeCustomer).mockResolvedValue({ workspaceId: WORKSPACE_ID, customerId: 'cus_1' })
    vi.mocked(stripe.customers.retrieve).mockResolvedValue(customer() as never)
    vi.mocked(stripe.invoices.create).mockResolvedValue({ id: 'in_1' } as never)
    vi.mocked(stripe.invoices.pay).mockResolvedValue({ id: 'in_1', status: 'paid', metadata: METADATA, payments: { data: [{ payment: { payment_intent: 'pi_1' } }] } } as never)
    vi.mocked(stripe.checkout.sessions.create).mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' } as never)
})

describe('quoteCreditPurchase', () => {
    it('quotes the invoice the card is about to pay, tax included', async () => {
        vi.mocked(stripe.invoices.createPreview).mockResolvedValue({ amount_due: 2400, total_taxes: [{ amount: 400 }] } as never)
        await expect(quoteCreditPurchase(2)).resolves.toEqual({ dueTodayCents: 2400, taxCents: 400, taxIncluded: true, card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 } })
        expect(vi.mocked(stripe.invoices.createPreview).mock.calls[0][0]).toMatchObject({ customer: 'cus_1', invoice_items: [{ price: 'price_credit_once', quantity: 2 }], automatic_tax: { enabled: true } })
    })

    it('quotes the bare price for a workspace that will pay on Checkout', async () => {
        workspace = { stripe_customer_id: null, stripe_subscription_id: null }
        await expect(quoteCreditPurchase(3)).resolves.toEqual({ dueTodayCents: 3000, taxCents: 0, taxIncluded: false, card: null })
        expect(stripe.invoices.createPreview).not.toHaveBeenCalled()
    })

    it.each([[0], [101], [1.5]])('refuses %s packs', async packs => {
        await expect(quoteCreditPurchase(packs)).rejects.toThrow()
    })
})

describe('buyCredit', () => {
    it('charges the card on file and grants the credit on the spot', async () => {
        await expect(buyCredit(2)).resolves.toEqual({ kind: 'paid' })
        expect(vi.mocked(stripe.invoices.create).mock.calls[0][0]).toMatchObject({ customer: 'cus_1', currency: 'usd', automatic_tax: { enabled: true }, pending_invoice_items_behavior: 'exclude', default_payment_method: 'pm_1', metadata: METADATA })
        expect(stripe.invoiceItems.create).toHaveBeenCalledWith({ customer: 'cus_1', invoice: 'in_1', pricing: { price: 'price_credit_once' }, quantity: 2 })
        expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith('in_1')
        expect(grants()).toEqual([{ p_workspace_id: 42, p_stripe_ref: 'pi_1', p_packs: 2, p_micros: 20_000_000 }])
    })

    it('falls back on the card of the plan subscription', async () => {
        vi.mocked(stripe.customers.retrieve).mockResolvedValue(customer({ invoice_settings: { default_payment_method: null } }) as never)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({ default_payment_method: { ...CARD, id: 'pm_sub' } } as never)
        await buyCredit(1)
        expect(vi.mocked(stripe.invoices.create).mock.calls[0][0]).toMatchObject({ default_payment_method: 'pm_sub' })
    })

    it('hands the browser the 3-D Secure secret and grants nothing yet', async () => {
        vi.mocked(stripe.invoices.pay).mockRejectedValue(Object.assign(new Error('requires action'), { code: 'invoice_payment_intent_requires_action' }))
        vi.mocked(stripe.invoices.retrieve).mockResolvedValue({ id: 'in_1', confirmation_secret: { client_secret: 'pi_1_secret_x' } } as never)
        await expect(buyCredit(2)).resolves.toEqual({ kind: 'confirm', clientSecret: 'pi_1_secret_x', invoiceId: 'in_1' })
        expect(assertPaymentAwaitsConfirmation).toHaveBeenCalledWith('pi_1_secret_x')
        expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled()
        expect(grants()).toEqual([])
    })

    it('voids the invoice of a declined card and passes the refusal on', async () => {
        vi.mocked(stripe.invoices.pay).mockRejectedValue(Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined' }))
        vi.mocked(stripe.invoices.voidInvoice).mockResolvedValue({} as never)
        await expect(buyCredit(2)).rejects.toThrow('Your card was declined.')
        expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_1')
        expect(grants()).toEqual([])
    })

    it('voids the invoice when the bank is not waiting for a confirmation', async () => {
        vi.mocked(stripe.invoices.pay).mockRejectedValue(Object.assign(new Error('requires action'), { code: 'invoice_payment_intent_requires_action' }))
        vi.mocked(stripe.invoices.retrieve).mockResolvedValue({ id: 'in_1', confirmation_secret: { client_secret: 'pi_1_secret_x' } } as never)
        vi.mocked(assertPaymentAwaitsConfirmation).mockRejectedValueOnce(new Error('Your card was declined.'))
        vi.mocked(stripe.invoices.voidInvoice).mockResolvedValue({} as never)
        await expect(buyCredit(2)).rejects.toThrow('Your card was declined.')
        expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_1')
    })

    it('answers paid once the card is charged, even when the grant fails', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        db = fakeSupabase(table => (table === 'workspaces' ? { data: workspace } : table === 'rpc:grant_rerun_credit_purchase' ? { error: { message: 'connection lost' } } : undefined))
        vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
        await expect(buyCredit(2)).resolves.toEqual({ kind: 'paid' })
        expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled()
        expect(logged).toHaveBeenCalled()
        logged.mockRestore()
    })

    it('deletes the draft invoice when Stripe refuses to build it', async () => {
        vi.mocked(stripe.invoiceItems.create).mockRejectedValue(new Error('The price specified only supports `usd`.'))
        vi.mocked(stripe.invoices.del).mockResolvedValue({} as never)
        await expect(buyCredit(1)).rejects.toThrow('only supports')
        expect(stripe.invoices.del).toHaveBeenCalledWith('in_1')
        expect(stripe.invoices.pay).not.toHaveBeenCalled()
    })

    it.each([
        ['no Stripe customer', () => (workspace = { stripe_customer_id: null, stripe_subscription_id: null })],
        ['no card', () => vi.mocked(stripe.customers.retrieve).mockResolvedValue(customer({ invoice_settings: { default_payment_method: null } }) as never)],
        ['no address to tax', () => vi.mocked(stripe.customers.retrieve).mockResolvedValue(customer({ address: null }) as never)],
    ])('opens a Checkout page for a workspace with %s', async (_label, setup) => {
        workspace = { stripe_customer_id: 'cus_1', stripe_subscription_id: null }
        setup()
        await expect(buyCredit(2)).resolves.toEqual({ kind: 'checkout', url: 'https://checkout.stripe.test/cs_1' })
        expect(vi.mocked(stripe.checkout.sessions.create).mock.calls[0][0]).toMatchObject({
            mode: 'payment',
            customer: 'cus_1',
            line_items: [{ price: 'price_credit_once', quantity: 2 }],
            payment_intent_data: { metadata: METADATA },
            automatic_tax: { enabled: true },
            metadata: METADATA,
        })
        expect(stripe.invoices.create).not.toHaveBeenCalled()
    })
})

describe('recording a purchase', () => {
    it('grants a paid credit invoice once, keyed on its payment intent', async () => {
        await recordCreditInvoice({ id: 'in_1', status: 'paid', metadata: METADATA, payments: { data: [{ payment: { payment_intent: 'pi_1' } }] } } as never)
        expect(grants()).toEqual([{ p_workspace_id: 42, p_stripe_ref: 'pi_1', p_packs: 2, p_micros: 20_000_000 }])
    })

    it('ignores an invoice that is not a credit purchase', async () => {
        await recordCreditInvoice({ id: 'in_1', status: 'paid', metadata: {} } as never)
        expect(grants()).toEqual([])
    })

    it('grants a paid Checkout session and keeps its card for the next pack', async () => {
        vi.mocked(stripe.customers.retrieve).mockResolvedValue(customer({ invoice_settings: { default_payment_method: null } }) as never)
        vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({ payment_method: 'pm_new' } as never)
        await recordCreditCheckoutSession({ metadata: METADATA, payment_status: 'paid', payment_intent: 'pi_2', customer: 'cus_1' } as never)
        expect(grants()).toEqual([{ p_workspace_id: 42, p_stripe_ref: 'pi_2', p_packs: 2, p_micros: 20_000_000 }])
        expect(stripe.customers.update).toHaveBeenCalledWith('cus_1', { invoice_settings: { default_payment_method: 'pm_new' } })
    })

    it('grants nothing for a session not paid yet', async () => {
        await recordCreditCheckoutSession({ metadata: METADATA, payment_status: 'unpaid', payment_intent: 'pi_2' } as never)
        expect(grants()).toEqual([])
    })
})

describe('the browser back from the payment', () => {
    const PAID_INVOICE = { id: 'in_1', status: 'paid', metadata: METADATA, payments: { data: [{ payment: { payment_intent: 'pi_1' } }] } }

    it('grants a Checkout session of its workspace ahead of the webhook', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ metadata: METADATA, payment_status: 'paid', payment_intent: 'pi_2', customer: 'cus_1' } as never)
        await expect(confirmCreditCheckout('cs_1')).resolves.toEqual({ packs: 2 })
        expect(grants()).toEqual([{ p_workspace_id: 42, p_stripe_ref: 'pi_2', p_packs: 2, p_micros: 20_000_000 }])
    })

    it('refuses the Checkout session of another workspace', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ metadata: { ...METADATA, workspace_id: '7' }, payment_status: 'paid', payment_intent: 'pi_2' } as never)
        await expect(confirmCreditCheckout('cs_1')).rejects.toThrow('another workspace')
        expect(grants()).toEqual([])
    })

    it('refuses a Checkout session that is not paid', async () => {
        vi.mocked(stripe.checkout.sessions.retrieve).mockResolvedValue({ metadata: METADATA, payment_status: 'unpaid', payment_intent: 'pi_2' } as never)
        await expect(confirmCreditCheckout('cs_1')).rejects.toThrow()
        expect(grants()).toEqual([])
    })

    it('grants an invoice the bank confirmed', async () => {
        vi.mocked(stripe.invoices.retrieve).mockResolvedValue(PAID_INVOICE as never)
        await settleCreditInvoice('in_1')
        expect(grants()).toEqual([{ p_workspace_id: 42, p_stripe_ref: 'pi_1', p_packs: 2, p_micros: 20_000_000 }])
    })

    it('refuses to settle the invoice of another workspace', async () => {
        vi.mocked(stripe.invoices.retrieve).mockResolvedValue({ ...PAID_INVOICE, metadata: { ...METADATA, workspace_id: '7' } } as never)
        await expect(settleCreditInvoice('in_1')).rejects.toThrow('another workspace')
        expect(grants()).toEqual([])
    })

    it('voids an invoice the bank did not confirm', async () => {
        vi.mocked(stripe.invoices.retrieve).mockResolvedValue({ id: 'in_1', status: 'open', metadata: METADATA } as never)
        vi.mocked(stripe.invoices.voidInvoice).mockResolvedValue({} as never)
        await abandonCreditInvoice('in_1')
        expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_1')
    })

    it('leaves a paid invoice alone', async () => {
        vi.mocked(stripe.invoices.retrieve).mockResolvedValue(PAID_INVOICE as never)
        await abandonCreditInvoice('in_1')
        expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled()
    })
})

describe('refundCreditPurchase', () => {
    function revokes() {
        return db.chainsOn('rpc:revoke_rerun_credit_purchase').map(chain => chain[0].args[1])
    }

    it('takes back the share of the credit refunded', async () => {
        await refundCreditPurchase({ payment_intent: 'pi_1', amount: 2400, amount_refunded: 1200 } as never)
        expect(revokes()).toEqual([{ p_stripe_ref: 'pi_1', p_refunded_micros: 10_000_000 }])
    })

    it('leaves a charge that bought no credit alone', async () => {
        purchase = null
        await refundCreditPurchase({ payment_intent: 'pi_9', amount: 1900, amount_refunded: 1900 } as never)
        expect(revokes()).toEqual([])
    })
})
