import { type SaleSplit, splitSale } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import type { Database } from '@/app/api/database.types'
import { stripeTimestampIso, subscriptionPeriodEndIso, TEMPLATE_PURCHASE_KIND } from '@/ee/lib/billing/marketplace'
import { idOf, stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { requestTemplateRevocation } from '@/ee/trigger/revoke-template-access'
import { reverseCreatorTransfer, transferSaleToCreator } from './creator-payout.service'
import { reenableAgentsForTemplate, revokeTemplateAccess } from './template-revocation.service'

// Every writer here upserts on (workspace_id, template_id), because event order is not guaranteed:
// `customer.subscription.created` regularly lands before `checkout.session.completed`, and both
// carry the whole metadata. Whichever arrives first creates the row, the other refines it.

type PurchaseInsert = Database['public']['Tables']['template_purchases']['Insert']
type SaleInsert = Database['public']['Tables']['template_sales']['Insert']

const PURCHASE_CONFLICT = 'workspace_id,template_id'

// What our own checkout writes on the session, the payment intent and the subscription alike.
type PurchaseMetadata = {
    workspaceId: number
    templateId: string
    templateSlug: string
    creatorId: string | null
    connectedAccountId: string | null
}

function readMetadata(metadata: Stripe.Metadata | null | undefined): PurchaseMetadata | null {
    if (metadata?.kind !== TEMPLATE_PURCHASE_KIND) return null

    const workspaceId = Number(metadata.workspace_id)
    if (!metadata.template_id || Number.isNaN(workspaceId)) return null

    return {
        workspaceId,
        templateId: metadata.template_id,
        templateSlug: metadata.template_slug ?? '',
        creatorId: metadata.creator_id || null,
        connectedAccountId: metadata.connected_account_id || null,
    }
}

// What the creator sees against the transfer in their Express dashboard, where a bare amount would
// tell them nothing about which template it paid for.
function transferMetadata(meta: PurchaseMetadata): Stripe.MetadataParam {
    return {
        kind: TEMPLATE_PURCHASE_KIND,
        workspace_id: String(meta.workspaceId),
        template_id: meta.templateId,
        template_slug: meta.templateSlug,
        creator_id: meta.creatorId ?? '',
    }
}

// The buyer lands back in the app before Stripe has finished delivering the webhook, so the
// return path replays this writer against the retrieved session. It has to stay idempotent.
export async function recordTemplatePurchase(session: Stripe.Checkout.Session): Promise<void> {
    if (session.payment_status !== 'paid') return
    const meta = readMetadata(session.metadata)
    if (!meta) return

    const supabase = createServiceRoleClient()
    const recurring = session.mode === 'subscription'
    const now = new Date().toISOString()

    const row: PurchaseInsert = {
        workspace_id: meta.workspaceId,
        template_id: meta.templateId,
        creator_id: meta.creatorId,
        purchased_by: session.client_reference_id,
        pricing_model: recurring ? 'recurring' : 'one_time',
        status: 'active',
        amount_cents: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: idOf(session.payment_intent),
        stripe_subscription_id: idOf(session.subscription),
        stripe_connected_account_id: meta.connectedAccountId,
        activated_at: now,
        revoked_at: null,
        updated_at: now,
    }

    const { error } = await supabase.from('template_purchases').upsert<PurchaseInsert>(row, { onConflict: PURCHASE_CONFLICT })
    if (error) throw new Error(`Failed to record the purchase: ${error.message}`)

    // Buying again after a lapse gives the agents back rather than a second copy of them.
    await reenableAgentsForTemplate(meta.workspaceId, meta.templateId)

    // A subscription's first invoice is billed through `invoice.paid` like every renewal, so only
    // the one-off writes its own ledger line here.
    if (!recurring) await recordOneTimeSale(session, meta)
}

async function recordOneTimeSale(session: Stripe.Checkout.Session, meta: PurchaseMetadata): Promise<void> {
    const paymentIntentId = idOf(session.payment_intent)
    if (!paymentIntentId) return

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
    const chargeId = idOf(intent.latest_charge)
    const gross = session.amount_total ?? intent.amount_received ?? 0
    const currency = session.currency ?? 'usd'

    const split = await transferSaleToCreator({
        chargeId,
        connectedAccountId: meta.connectedAccountId,
        grossCents: gross,
        taxCents: session.total_details?.amount_tax ?? 0,
        currency,
        metadata: transferMetadata(meta),
    })

    await insertSale({
        meta,
        kind: 'one_time',
        grossCents: gross,
        split,
        currency,
        chargeId,
        invoiceId: null,
        transferId: split.transferId,
        occurredAt: stripeTimestampIso(session.created) ?? new Date().toISOString(),
    })
}

// `customer.subscription.*` for a template subscription. Status maps onto the purchase's own,
// with `past_due` kept entitled: Stripe retries a failed invoice for weeks before giving up, and
// cutting a paying customer off on the first declined card is hostile. Revocation happens on
// `deleted`, not here.
export async function applyTemplateSubscription(subscription: Stripe.Subscription): Promise<void> {
    const meta = readMetadata(subscription.metadata)
    if (!meta) return

    const supabase = createServiceRoleClient()
    const item = subscription.items?.data?.[0]
    const now = new Date().toISOString()

    const status: Database['public']['Enums']['template_purchase_status'] =
        subscription.status === 'active' || subscription.status === 'trialing'
            ? 'active'
            : subscription.status === 'past_due' || subscription.status === 'unpaid'
              ? 'past_due'
              : 'canceled'

    const row: PurchaseInsert = {
        workspace_id: meta.workspaceId,
        template_id: meta.templateId,
        creator_id: meta.creatorId,
        pricing_model: 'recurring',
        status,
        amount_cents: (item?.price?.unit_amount ?? 0) * (item?.quantity ?? 1),
        currency: item?.price?.currency ?? 'usd',
        stripe_subscription_id: subscription.id,
        stripe_price_id: item?.price?.id ?? null,
        stripe_connected_account_id: meta.connectedAccountId,
        current_period_end: subscriptionPeriodEndIso(subscription),
        cancel_at_period_end: !!subscription.cancel_at_period_end,
        ...(status === 'active' ? { activated_at: now, revoked_at: null } : {}),
        updated_at: now,
    }

    const { error } = await supabase.from('template_purchases').upsert<PurchaseInsert>(row, { onConflict: PURCHASE_CONFLICT })
    if (error) throw new Error(`Failed to sync the template subscription: ${error.message}`)

    if (status === 'active') await reenableAgentsForTemplate(meta.workspaceId, meta.templateId)
}

export async function revokeTemplateSubscription(subscription: Stripe.Subscription): Promise<void> {
    const meta = readMetadata(subscription.metadata)
    if (!meta) return

    await revokeTemplateAccess(meta.workspaceId, meta.templateId)
    await requestTemplateRevocation({ workspaceId: meta.workspaceId, templateId: meta.templateId })
}

// Every paid invoice of a template subscription, including the first one. The ledger is keyed on
// the invoice, so a replay writes nothing twice.
export async function recordTemplateRenewal(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoiceSubscriptionId(invoice)
    if (!subscriptionId) return

    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    const meta = readMetadata(subscription.metadata)
    if (!meta) return

    const supabase = createServiceRoleClient()
    const { data: purchase } = await selectMaybeSingle(supabase, 'template_purchases', ['id'] as const, {
        workspace_id: meta.workspaceId,
        template_id: meta.templateId,
    })

    const gross = invoice.amount_paid ?? 0
    const currency = invoice.currency ?? 'usd'
    const chargeId = await chargeOfInvoice(invoice)

    const split = await transferSaleToCreator({
        chargeId,
        connectedAccountId: meta.connectedAccountId,
        grossCents: gross,
        taxCents: (invoice.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0),
        currency,
        metadata: transferMetadata(meta),
    })

    await insertSale({
        meta,
        kind: 'recurring',
        grossCents: gross,
        split,
        currency,
        chargeId,
        invoiceId: invoice.id ?? null,
        transferId: split.transferId,
        occurredAt: stripeTimestampIso(invoice.created) ?? new Date().toISOString(),
        purchaseId: purchase?.id ?? null,
    })
}

// The invoice stopped carrying its charge at the top level in recent API versions: it hangs off the
// payment now, itself usually a PaymentIntent rather than a charge. `payments` is only present when
// expanded, so the list endpoint is the reliable read.
async function chargeOfInvoice(invoice: Stripe.Invoice): Promise<string | null> {
    const legacy = idOf((invoice as unknown as { charge?: string | { id: string } | null }).charge)
    if (legacy) return legacy
    if (!invoice.id) return null

    const payments = invoice.payments?.data ?? (await stripe.invoicePayments.list({ invoice: invoice.id, limit: 3 })).data

    for (const entry of payments) {
        const direct = idOf(entry.payment?.charge)
        if (direct) return direct

        const intentId = idOf(entry.payment?.payment_intent)
        if (!intentId) continue

        const intent = await stripe.paymentIntents.retrieve(intentId)
        const chargeId = idOf(intent.latest_charge)
        if (chargeId) return chargeId
    }

    return null
}

// The subscription moved from the invoice to its parent in recent API versions; read the new
// shape, fall back to the legacy top-level field.
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const parent = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent
    const fromParent = idOf(parent?.subscription_details?.subscription)
    if (fromParent) return fromParent

    return idOf((invoice as unknown as { subscription?: string | { id: string } | null }).subscription)
}

const REFUNDED_SALE_COLUMNS = [
    'workspace_id',
    'template_id',
    'template_slug',
    'creator_id',
    'stripe_connected_account_id',
    'gross_cents',
    'tax_cents',
    'application_fee_cents',
    'net_cents',
    'stripe_transfer_id',
] as const

// A refund reverses the entitlement as well as the money: a buyer who got their money back does
// not keep the template. Stored as a negative line so the totals net out on their own.
//
// The refund itself comes out of the platform balance and leaves the creator's transfer alone, so
// the reversal is what keeps a refund from costing Rerun the full price of the template.
export async function refundTemplatePurchase(charge: Stripe.Charge): Promise<void> {
    const supabase = createServiceRoleClient()
    const refunded = charge.amount_refunded ?? 0
    if (refunded <= 0) return

    const { data: sale } = await selectMaybeSingle(supabase, 'template_sales', REFUNDED_SALE_COLUMNS, { stripe_charge_id: charge.id })

    // A renewal charge carries no metadata of ours: Stripe does not copy a subscription's onto the
    // invoice's payment. The ledger line written when the sale settled is the way back to the
    // template, and without it there would be nothing to reverse a renewal refund against.
    const meta = readMetadata(charge.metadata) ?? metaOfSale(sale)
    if (!meta) return

    if (sale?.stripe_transfer_id) {
        try {
            await reverseCreatorTransfer(sale.stripe_transfer_id, refunded, charge.amount)
        } catch (err) {
            // A creator whose balance has already been paid out goes negative instead, and that is a
            // recovery problem, not a reason to make Stripe retry the refund event forever.
            console.error('[template refund] transfer reversal failed', sale.stripe_transfer_id, err)
        }
    }

    // `amount_refunded` is the running total of every refund on the charge, so each event writes what
    // the lines already recorded do not cover yet. A replay, or an earlier refund arriving after a
    // later one, finds nothing left to write.
    const recorded = await recordedRefund(supabase, charge.id)
    const owed = refundedSplit(sale, refunded)
    if (refunded > recorded.grossCents) {
        await insertSale({
            meta,
            kind: 'refund',
            grossCents: -(refunded - recorded.grossCents),
            // Mirrored from the original line so a partial refund gives back its own share of the tax
            // and of the fee, rather than a figure recomputed under whatever the barème says today.
            split: { taxCents: owed.taxCents - recorded.taxCents, feeCents: owed.feeCents - recorded.feeCents, netCents: owed.netCents - recorded.netCents },
            currency: charge.currency ?? 'usd',
            // The first refund keeps the key every line written so far carries; a later one is keyed on
            // the running total, which only grows, so a replay of it lands on the same key.
            chargeId: recorded.grossCents === 0 ? `${charge.id}_refund` : `${charge.id}_refund_${refunded}`,
            invoiceId: null,
            transferId: sale?.stripe_transfer_id ?? null,
            occurredAt: new Date().toISOString(),
        })
    }

    // A partial refund leaves the purchase alone: only giving the whole amount back takes the
    // template with it.
    if (refunded < charge.amount) return

    await revokeTemplateAccess(meta.workspaceId, meta.templateId, 'refunded')
    await requestTemplateRevocation({ workspaceId: meta.workspaceId, templateId: meta.templateId })
}

// What the refund lines of a charge add up to, as positive amounts for the gross and negative ones
// for the split, the way they are stored.
async function recordedRefund(supabase: SupabaseClient<Database>, chargeId: string) {
    const { data, error } = await selectMany(supabase, 'template_sales', ['gross_cents', 'tax_cents', 'application_fee_cents', 'net_cents'] as const, { kind: 'refund', stripe_charge_id: { like: `${chargeId}_refund%` } })
    if (error) throw new Error(`Failed to read the refunds already recorded: ${error.message}`)
    return (data ?? []).reduce(
        (total, line) => ({ grossCents: total.grossCents - line.gross_cents, taxCents: total.taxCents + line.tax_cents, feeCents: total.feeCents + line.application_fee_cents, netCents: total.netCents + line.net_cents }),
        { grossCents: 0, taxCents: 0, feeCents: 0, netCents: 0 },
    )
}

type RefundedSaleRow = Pick<Database['public']['Tables']['template_sales']['Row'], (typeof REFUNDED_SALE_COLUMNS)[number]>

function metaOfSale(sale: RefundedSaleRow | null): PurchaseMetadata | null {
    if (!sale?.template_id || sale.workspace_id === null) return null

    return {
        workspaceId: sale.workspace_id,
        templateId: sale.template_id,
        templateSlug: sale.template_slug,
        creatorId: sale.creator_id,
        connectedAccountId: sale.stripe_connected_account_id,
    }
}

function refundedSplit(sale: RefundedSaleRow | null, refundedCents: number): SaleSplit {
    if (!sale || sale.gross_cents <= 0) {
        const fallback = splitSale(refundedCents, 0)
        return { taxCents: 0, feeCents: -fallback.feeCents, netCents: -fallback.netCents }
    }

    const ratio = refundedCents >= sale.gross_cents ? 1 : refundedCents / sale.gross_cents
    return {
        taxCents: -Math.round(sale.tax_cents * ratio),
        feeCents: -Math.round(sale.application_fee_cents * ratio),
        netCents: -Math.round(sale.net_cents * ratio),
    }
}

type SaleParams = {
    meta: PurchaseMetadata
    kind: 'one_time' | 'recurring' | 'refund'
    grossCents: number
    split: SaleSplit
    currency: string
    chargeId: string | null
    invoiceId: string | null
    transferId: string | null
    occurredAt: string
    purchaseId?: string | null
}

// The ledger snapshots the title and slug so a deleted template does not erase its own revenue
// history, which is exactly the history the creator is owed an account of.
async function insertSale(params: SaleParams): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: template } = await selectMaybeSingle(supabase, 'templates', ['slug', 'title'] as const, { id: params.meta.templateId })

    // `net_cents` is the amount actually transferred to the creator, so gross minus tax minus fee. It
    // is read as-is by the revenue panel and must never be recomputed from gross alone.
    const row: SaleInsert = {
        template_id: params.meta.templateId,
        template_slug: template?.slug ?? params.meta.templateSlug,
        template_title: template?.title ?? params.meta.templateSlug,
        creator_id: params.meta.creatorId,
        workspace_id: params.meta.workspaceId,
        purchase_id: params.purchaseId ?? null,
        kind: params.kind,
        gross_cents: params.grossCents,
        tax_cents: params.split.taxCents,
        application_fee_cents: params.split.feeCents,
        net_cents: params.split.netCents,
        currency: params.currency,
        stripe_charge_id: params.chargeId,
        stripe_invoice_id: params.invoiceId,
        stripe_transfer_id: params.transferId,
        stripe_connected_account_id: params.meta.connectedAccountId,
        occurred_at: params.occurredAt,
    }

    // The unique indexes on the charge and the invoice are what make a replay a no-op; a conflict
    // here is the expected outcome of a retry, not a failure.
    const { error } = await supabase.from('template_sales').insert<SaleInsert>(row)
    if (error && error.code !== '23505') throw new Error(`Failed to record the sale: ${error.message}`)
}
