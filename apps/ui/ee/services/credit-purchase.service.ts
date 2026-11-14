import { CREDIT_PACK_PRICE_CENTS, CREDIT_USD_PER_PACK, MAX_CREDIT_PACKS_PER_PURCHASE } from '@rerun/contracts'
import type Stripe from 'stripe'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { getAppOrigin } from '@/lib/app-origin'
import { AppError } from '@/lib/i18n/action-error'
import { CREDIT_PURCHASE_CONSENT } from '@/ee/lib/billing/consent'
import { MICROS_PER_USD, PLAN_CURRENCY } from '@/ee/lib/billing/plans'
import { creditPackOncePriceId, idOf, stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'
import { assertPaymentAwaitsConfirmation, ensureStripeCustomer, savedCard, type SavedCard } from './billing.service'

// Rerun credit bought once: it lands in `rerun_topup_micros`, which no renewal resets. With a card
// on file and an address to tax, the card is charged from the dialog through a one-off invoice; a
// workspace without them pays on a Stripe Checkout page, which collects both.
export const CREDIT_PURCHASE_KIND = 'credit_purchase'

export type CreditQuote = {
    dueTodayCents: number
    taxCents: number
    // False when the purchase goes through Checkout: the tax is only known once the address is.
    taxIncluded: boolean
    card: SavedCard | null
}

export type CreditPurchaseResult = { kind: 'paid' } | { kind: 'confirm'; clientSecret: string; invoiceId: string } | { kind: 'checkout'; url: string }

type PurchaseContext = { workspaceId: number; customerId: string | null; paymentMethod: Stripe.PaymentMethod | null }

function assertPacks(packs: number): void {
    if (!Number.isInteger(packs) || packs < 1 || packs > MAX_CREDIT_PACKS_PER_PURCHASE) throw new AppError('invalidAddonQuantity')
}

function creditMicros(packs: number): number {
    return packs * CREDIT_USD_PER_PACK * MICROS_PER_USD
}

// The card a one-off invoice can be charged on: the customer's default, or the one the plan
// subscription pays with. Only once the customer has a country, without which Stripe cannot tax it.
async function loadPurchaseContext(): Promise<PurchaseContext> {
    const workspaceId = await requireWorkspaceId()
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['stripe_customer_id', 'stripe_subscription_id'] as const, { id: workspaceId })
    const customerId = workspace?.stripe_customer_id ?? null
    if (!customerId) return { workspaceId, customerId: null, paymentMethod: null }

    const customer = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] })
    if (customer.deleted) return { workspaceId, customerId: null, paymentMethod: null }
    if (!customer.address?.country) return { workspaceId, customerId, paymentMethod: null }

    let paymentMethod = customer.invoice_settings?.default_payment_method ?? null
    if (!paymentMethod && workspace?.stripe_subscription_id) {
        const subscription = await stripe.subscriptions.retrieve(workspace.stripe_subscription_id, { expand: ['default_payment_method'] })
        paymentMethod = subscription.default_payment_method
    }
    return { workspaceId, customerId, paymentMethod: paymentMethod && typeof paymentMethod === 'object' ? paymentMethod : null }
}

function chargeable(context: PurchaseContext): context is PurchaseContext & { customerId: string; paymentMethod: Stripe.PaymentMethod } {
    return !!context.customerId && !!context.paymentMethod
}

export async function quoteCreditPurchase(packs: number): Promise<CreditQuote> {
    assertPacks(packs)
    const context = await loadPurchaseContext()
    if (!chargeable(context)) return { dueTodayCents: packs * CREDIT_PACK_PRICE_CENTS, taxCents: 0, taxIncluded: false, card: null }

    const preview = await stripe.invoices.createPreview({
        customer: context.customerId,
        currency: PLAN_CURRENCY,
        invoice_items: [{ price: creditPackOncePriceId(), quantity: packs }],
        automatic_tax: { enabled: true },
    })
    const taxCents = (preview.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0)
    return { dueTodayCents: preview.amount_due, taxCents, taxIncluded: true, card: savedCard(context.paymentMethod) }
}

export async function buyCredit(packs: number): Promise<CreditPurchaseResult> {
    assertPacks(packs)
    const context = await loadPurchaseContext()
    if (!chargeable(context)) return { kind: 'checkout', url: await createCreditCheckoutSession(packs) }

    const metadata: Stripe.MetadataParam = { kind: CREDIT_PURCHASE_KIND, workspace_id: String(context.workspaceId), packs: String(packs) }
    const draft = await stripe.invoices.create({
        customer: context.customerId,
        // Else the account's own currency, which the USD price refuses.
        currency: PLAN_CURRENCY,
        collection_method: 'charge_automatically',
        auto_advance: false,
        automatic_tax: { enabled: true },
        // Only this purchase: an item left pending on the customer belongs to the plan's next invoice.
        pending_invoice_items_behavior: 'exclude',
        default_payment_method: context.paymentMethod.id,
        metadata,
    })
    const invoiceId = draft.id!
    try {
        await stripe.invoiceItems.create({ customer: context.customerId, invoice: invoiceId, pricing: { price: creditPackOncePriceId() }, quantity: packs })
        await stripe.invoices.finalizeInvoice(invoiceId)
    } catch (err) {
        await stripe.invoices.del(invoiceId).catch(delErr => console.error('[credit purchase] could not delete a draft invoice', invoiceId, delErr))
        throw err
    }

    let paid: Stripe.Invoice
    try {
        paid = await stripe.invoices.pay(invoiceId)
    } catch (err) {
        if ((err as { code?: string } | null)?.code !== 'invoice_payment_intent_requires_action') {
            await voidUnpaidInvoice(invoiceId)
            throw err
        }
        return await awaitBankConfirmation(invoiceId)
    }
    // The card is charged: a grant that fails now is `invoice.paid`'s to replay, not a failed purchase
    // the customer would pay for a second time.
    await recordCreditInvoice(paid).catch(err => console.error('[credit purchase] grant left to the webhook', invoiceId, err))
    return { kind: 'paid' }
}

// The bank asks for 3-D Secure: the browser confirms, then names the invoice again to settle it, or
// to abandon it when the confirmation failed.
async function awaitBankConfirmation(invoiceId: string): Promise<CreditPurchaseResult> {
    try {
        const open = await stripe.invoices.retrieve(invoiceId, { expand: ['confirmation_secret'] })
        const clientSecret = open.confirmation_secret?.client_secret
        if (!clientSecret) throw new AppError('chargeRefused')
        await assertPaymentAwaitsConfirmation(clientSecret)
        return { kind: 'confirm', clientSecret, invoiceId }
    } catch (err) {
        await voidUnpaidInvoice(invoiceId)
        throw err
    }
}

// Nothing collects a one-off invoice after the dialog: left open, it stays due on the customer.
async function voidUnpaidInvoice(invoiceId: string): Promise<void> {
    await stripe.invoices.voidInvoice(invoiceId).catch(err => console.error('[credit purchase] could not void an unpaid invoice', invoiceId, err))
}

// An invoice the browser names is only acted on when it is a credit purchase of its own workspace.
async function ownCreditInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const workspaceId = await requireWorkspaceId()
    const invoice = await stripe.invoices.retrieve(invoiceId)
    if (readPurchaseMetadata(invoice.metadata)?.workspaceId !== workspaceId) throw new AppError('purchaseOtherWorkspace')
    return invoice
}

// The browser back from the bank's confirmation: the credit lands without waiting for `invoice.paid`.
export async function settleCreditInvoice(invoiceId: string): Promise<void> {
    await recordCreditInvoice(await ownCreditInvoice(invoiceId))
}

export async function abandonCreditInvoice(invoiceId: string): Promise<void> {
    const invoice = await ownCreditInvoice(invoiceId)
    if (invoice.status === 'open') await voidUnpaidInvoice(invoiceId)
}

async function createCreditCheckoutSession(packs: number): Promise<string> {
    const { workspaceId, customerId } = await ensureStripeCustomer()
    const origin = await getAppOrigin()
    const metadata: Stripe.MetadataParam = { kind: CREDIT_PURCHASE_KIND, workspace_id: String(workspaceId), packs: String(packs) }

    const checkout = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        line_items: [{ price: creditPackOncePriceId(), quantity: packs }],
        // Card only: a delayed method completes the session as `unpaid`, and the credit is granted on
        // completion, so every grant requires `payment_status: 'paid'`.
        payment_method_types: ['card'],
        // Without it a `payment` session charges the card and forgets it; with it the next pack is
        // bought from the dialog.
        payment_intent_data: { metadata, setup_future_usage: 'off_session' },
        saved_payment_method_options: { allow_redisplay_filters: ['always', 'limited', 'unspecified'] },
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        customer_update: { address: 'auto', name: 'auto' },
        invoice_creation: { enabled: true },
        ...CREDIT_PURCHASE_CONSENT,
        metadata,
        // {CHECKOUT_SESSION_ID} is a Stripe literal, not a template hole to interpolate.
        success_url: `${origin}/?credit=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?billing=cancel`,
    })
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL')
    return checkout.url
}

type PurchaseMetadata = { workspaceId: number; packs: number }

function readPurchaseMetadata(metadata: Stripe.Metadata | null | undefined): PurchaseMetadata | null {
    if (metadata?.kind !== CREDIT_PURCHASE_KIND) return null
    const workspaceId = Number(metadata.workspace_id)
    const packs = Number(metadata.packs)
    if (!Number.isInteger(workspaceId) || workspaceId <= 0 || !Number.isInteger(packs) || packs <= 0) return null
    return { workspaceId, packs }
}

export function isCreditCheckoutSession(session: Stripe.Checkout.Session): boolean {
    return session.metadata?.kind === CREDIT_PURCHASE_KIND
}

// Keyed on the payment intent, so the dialog's own charge, the webhook and any replay of either grant
// the pack once.
async function grantPurchase({ workspaceId, packs }: PurchaseMetadata, stripeRef: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { error } = await supabase.rpc('grant_rerun_credit_purchase', { p_workspace_id: workspaceId, p_stripe_ref: stripeRef, p_packs: packs, p_micros: creditMicros(packs) })
    if (error) throw new Error(`Could not grant the Rerun credit bought: ${error.message}`)
}

async function paymentIntentOfInvoice(invoice: Stripe.Invoice): Promise<string | null> {
    if (!invoice.id) return null
    const payments = invoice.payments?.data ?? (await stripe.invoicePayments.list({ invoice: invoice.id, limit: 3 })).data
    for (const entry of payments) {
        const intentId = idOf(entry.payment?.payment_intent)
        if (intentId) return intentId
    }
    return null
}

// `invoice.paid` of a one-off credit invoice, and the dialog's charge that paid on the spot.
export async function recordCreditInvoice(invoice: Stripe.Invoice): Promise<void> {
    const meta = readPurchaseMetadata(invoice.metadata)
    if (!meta || invoice.status !== 'paid') return
    await grantPurchase(meta, (await paymentIntentOfInvoice(invoice)) ?? invoice.id!)
}

export async function recordCreditCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
    const meta = readPurchaseMetadata(session.metadata)
    const intentId = idOf(session.payment_intent)
    if (!meta || session.payment_status !== 'paid' || !intentId) return
    await grantPurchase(meta, intentId)
    await adoptCardWhenNoneOnFile(session, intentId)
}

// The browser back from Checkout, ahead of `checkout.session.completed`.
export async function confirmCreditCheckout(sessionId: string): Promise<{ packs: number }> {
    const workspaceId = await requireWorkspaceId()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const meta = readPurchaseMetadata(session.metadata)
    if (meta?.workspaceId !== workspaceId) throw new AppError('purchaseOtherWorkspace')
    if (session.payment_status !== 'paid') throw new AppError('confirmPurchaseFailed')
    await recordCreditCheckoutSession(session)
    return { packs: meta.packs }
}

// The card typed on Checkout pays the next pack from the dialog, unless the customer already has one.
async function adoptCardWhenNoneOnFile(session: Stripe.Checkout.Session, intentId: string): Promise<void> {
    const customerId = idOf(session.customer)
    if (!customerId) return
    try {
        const customer = await stripe.customers.retrieve(customerId)
        if (customer.deleted || customer.invoice_settings?.default_payment_method) return
        const paymentMethodId = idOf((await stripe.paymentIntents.retrieve(intentId)).payment_method)
        if (paymentMethodId) await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } })
    } catch (err) {
        console.error('[credit purchase] could not keep the checkout card on file', err)
    }
}

// A refund takes back the same share of the credit, as much of it as is left.
export async function refundCreditPurchase(charge: Stripe.Charge): Promise<void> {
    const intentId = idOf(charge.payment_intent)
    if (!intentId || !charge.amount || !charge.amount_refunded) return
    const supabase = createServiceRoleClient()
    const { data: purchase } = await selectMaybeSingle(supabase, 'rerun_credit_purchases', ['micros'] as const, { stripe_ref: intentId })
    if (!purchase) return
    const refundedMicros = Math.floor((purchase.micros * Math.min(charge.amount_refunded, charge.amount)) / charge.amount)
    const { error } = await supabase.rpc('revoke_rerun_credit_purchase', { p_stripe_ref: intentId, p_refunded_micros: refundedMicros })
    if (error) throw new Error(`Could not take back the Rerun credit refunded: ${error.message}`)
}
