import { requestLocale } from '@/lib/i18n/request-locale'
import { DEFAULT_LOCALE, PSEUDO_LOCALE } from '@rerun/i18n'
import { realEmail } from '@/lib/auth/placeholder-email'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { Database } from '@/app/api/database.types'
import { getAppOrigin } from '@/lib/app-origin'
import {
    ADDON_KEYS,
    BASE_PLAN_SLUG,
    BILLING_INTERVALS,
    PLAN_CURRENCY,
    ZERO_QUANTITIES,
    basePriceCents,
    isLifetimePlan,
    parsePriceArm,
    planPriceCents,
    quantitiesToColumns,
    type AddonQuantities,
    type BillingInterval,
    type PriceArm,
    type WorkspaceLimitColumns,
} from '@/ee/lib/billing/plans'
import { affiliateReferralMetadata } from '@/ee/lib/billing/affiliate'
import {
    CANCEL_COMEBACK_METADATA_KEY,
    CANCEL_REASON_CHECK_METADATA_KEY,
    RETENTION_CLAIMED_METADATA_KEY,
    addOneMonth,
    cancelFlowPhase,
    offerPriceCents,
    paidLeftCents,
    reminderDate,
    retentionCouponId,
    retentionCouponParams,
    retentionOfferFor,
    retentionOfferOfCoupon,
    type CancelComeback,
    type CancelPhase,
    type CancelReason,
    type CancelReasonCheck,
    type RetentionOfferKind,
} from '@/ee/lib/billing/cancel-flow'
import { ARCHIVE_RETENTION_DAYS } from '@/lib/archive/retention'
import { canEndTrialNow, isMachineEntitled, isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { BOX_DELETION_GRACE_MS } from '@/ee/lib/billing/grace'
import { isTemplateSubscription, stripeTimestampIso, subscriptionPeriodEndIso } from '@/ee/lib/billing/marketplace'
import { isSameSubscription, shouldAdoptSubscription } from '@/ee/lib/billing/ownership'
import { hasPeriodAdvanced, rerunPeriodUpdate } from '@/ee/lib/billing/period'
import { trialArm } from '@/ee/lib/billing/trial-experiment'
import { normalizeTaxIdValue, taxIdTypesFor, type TaxIdStatus, type TaxIdType } from '@/ee/lib/billing/tax-id'
import {
    addonForPriceId,
    basePriceId,
    intervalOfItems,
    isBasePriceId,
    isLegacyPlanItemPriceId,
    isYearlyBasePriceId,
    legacyBaseDiscountCents,
    priceArmOfItems,
    priceIdForAddon,
    quantitiesFromItems,
    stripe,
    subscriptionOfInvoice,
} from '@/ee/lib/billing/stripe'
import { TRIAL_ACTIVE_AGENTS, TRIAL_DAYS, type ForemanClient } from '@rerun/contracts'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession, getSessionWorkspace } from '@/supabase/session/getServerSession'
import { reconcileAgentActivation, wakePlanLimitedAgents } from '@/app/api/_services/agent-activation.service'
import { SLOT_PAUSE_REASONS, subscriberTrialOpen, syncWorkspaceAppSlots } from '@/lib/apps/slots-sync'
import { APP_ADDON_KEYS, APP_SLUGS, SLOT_HOLDING_STATUSES } from '@/lib/apps/types'
import { APP_INFO } from '@/lib/apps/catalog'
import { isPhoneStepPending } from '@/app/api/_services/phone-gate.service'
import { AppError } from '@/lib/i18n/action-error'
import { requestAgentActivationSync } from '@/trigger/sync-agent-activation'
import { selectMany, selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'
import { sendPaymentFailedNotice } from '@/ee/lib/lifecycle/payment-failed-notice'
import { sendTrialStartedReceipt } from '@/ee/lib/lifecycle/trial-receipt'
import { reportSubscriptionCancelled, reportSubscriptionTransition, reportTrialConverted, reportTrialPaymentFailed } from './billing-analytics.service'
import { requestBoxRestore } from '@rerun/cloud/engines'
import { resolveEngineWaitlist } from '@/app/api/_services/waitlist.service'
import { syncEnginePlan } from '@/app/api/_services/workspace-engine.service'
import type Stripe from 'stripe'

type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

export const PLAN_CARD_SETUP_KIND = 'plan_card_setup'

const PLAN_PAYMENT_METHOD_TYPES: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = ['card', 'link']

export const ENGINE_WAITLIST_MESSAGE = 'Every machine is taken right now. Your trial can start as soon as one frees up.'

export async function ensureStripeCustomer(): Promise<{ workspaceId: number; customerId: string }> {
    const workspaceId = await requireWorkspaceId()
    const { session } = await getServerSession()
    const supabase = createServiceRoleClient()

    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['id', 'name', 'stripe_customer_id'] as const, { id: workspaceId })
    if (workspace?.stripe_customer_id) return { workspaceId, customerId: workspace.stripe_customer_id }

    const locale = await requestLocale().catch(() => DEFAULT_LOCALE)
    const customer = await stripe.customers.create({
        email: realEmail(session?.email) ?? undefined,
        name: workspace?.name ?? undefined,
        metadata: { workspace_id: String(workspaceId) },
        preferred_locales: [locale === PSEUDO_LOCALE ? DEFAULT_LOCALE : locale],
    })

    const { error } = await supabase.from('workspaces').update<WorkspaceUpdate>({ stripe_customer_id: customer.id }).eq('id', workspaceId)
    if (error) throw new Error(`Failed to persist Stripe customer: ${error.message}`)

    return { workspaceId, customerId: customer.id }
}

export async function syncStripeCustomerEmail(userId: string, email: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: memberships } = await selectMany(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId })
    const workspaceIds = (memberships ?? []).map(membership => membership.workspace_id)
    if (!workspaceIds.length) return

    const { data: workspaces } = await selectMany(supabase, 'workspaces', ['stripe_customer_id'] as const, { id: workspaceIds })
    for (const { stripe_customer_id: customerId } of workspaces ?? []) {
        if (!customerId) continue
        const customer = await stripe.customers.retrieve(customerId)
        if (customer.deleted || realEmail(customer.email)) continue
        await stripe.customers.update(customerId, { email })
    }
}

async function ensureCustomerEmail(customerId: string): Promise<void> {
    const { session } = await getServerSession()
    if (!session?.email) return
    const customer = await stripe.customers.retrieve(customerId)
    if (customer.deleted || customer.email) return
    await stripe.customers.update(customerId, { email: session.email })
}

async function basePlanCheckoutParams(): Promise<{ params: Omit<Stripe.Checkout.SessionCreateParams, 'line_items'>; priceArm: PriceArm }> {
    const { session } = await getServerSession()
    if (session && (await isPhoneStepPending(createServiceRoleClient(), session.id))) throw new AppError('phoneRequired')
    const { data: current } = await selectSingle(createServiceRoleClient(), 'workspaces', ['plan'] as const, { id: await requireWorkspaceId() })
    if (isLifetimePlan(current)) throw new AppError('lifetimePlan')

    const { workspaceId, customerId } = await ensureStripeCustomer()
    if (await resolveEngineWaitlist(workspaceId)) throw new AppError('engineWaitlist')

    await refuseSecondPlanSubscription(workspaceId, customerId)
    await ensureCustomerEmail(customerId)

    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['trial_ends_at', 'subscription_status', 'price_arm'] as const, { id: workspaceId })
    const trialEligible = !workspace?.trial_ends_at && !isSubscriptionEntitled(workspace?.subscription_status)

    const referral = await affiliateReferralMetadata()
    const params: Omit<Stripe.Checkout.SessionCreateParams, 'line_items'> = {
        mode: 'subscription',
        customer: customerId,
        metadata: { ...referral, workspace_id: String(workspaceId) },
        currency: PLAN_CURRENCY,
        subscription_data: {
            metadata: { workspace_id: String(workspaceId), plan: BASE_PLAN_SLUG, ...referral },
            ...(trialEligible ? { trial_period_days: TRIAL_DAYS } : {}),
        },
        payment_method_collection: 'always',
        payment_method_types: PLAN_PAYMENT_METHOD_TYPES,
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        customer_update: { address: 'auto', name: 'auto' },
        allow_promotion_codes: true,
    }
    return { params, priceArm: parsePriceArm(workspace?.price_arm) }
}

export async function startCardlessTrial(client: ForemanClient = 'web'): Promise<boolean> {
    const { session, isAnonymous } = await getServerSession()
    if (!session || isAnonymous) return false

    const workspaceId = await requireWorkspaceId()
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['trial_ends_at', 'subscription_status', 'is_sandbox', 'price_arm'] as const, { id: workspaceId })
    if (!workspace || workspace.is_sandbox) return false
    if (isSubscriptionEntitled(workspace.subscription_status)) return true
    if (workspace.trial_ends_at) return false
    if (client === 'web' && trialArm(workspaceId) === 'card') return false
    if (await isPhoneStepPending(supabase, session.id)) throw new AppError('phoneRequired')
    if (await resolveEngineWaitlist(workspaceId)) throw new AppError('engineWaitlist')

    const { customerId } = await ensureStripeCustomer()
    await refuseSecondPlanSubscription(workspaceId, customerId)

    const referral = await affiliateReferralMetadata()
    const subscription = await stripe.subscriptions.create(
        {
            customer: customerId,
            items: [{ price: basePriceId('monthly', parsePriceArm(workspace.price_arm)), quantity: 1 }],
            currency: PLAN_CURRENCY,
            trial_period_days: TRIAL_DAYS,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            metadata: { workspace_id: String(workspaceId), plan: BASE_PLAN_SLUG, origin: client, ...referral },
            automatic_tax: { enabled: false },
            payment_settings: { save_default_payment_method: 'on_subscription' },
        },
        { idempotencyKey: `cardless-trial-ws-${workspaceId}` }
    )

    await applySubscriptionToWorkspace(subscription)
    return isSubscriptionEntitled(subscription.status)
}

export type PlanSelection = { quantities: AddonQuantities; interval: BillingInterval }

const CARD_TRIAL_SELECTION: PlanSelection = { quantities: ZERO_QUANTITIES, interval: 'monthly' }

const CARD_TRIAL_METADATA_KEY = 'card_trial'
const TERMS_ACCEPTED_METADATA_KEY = 'terms_accepted_at'

function assertValidSelection(selection: PlanSelection): void {
    assertValidQuantities(selection.quantities)
    if (!BILLING_INTERVALS.includes(selection.interval)) throw new AppError('invalidBillingInterval')
}

function planLineItems({ quantities, interval }: PlanSelection, priceArm: PriceArm): { price: string; quantity: number }[] {
    return [
        { price: basePriceId(interval, priceArm), quantity: 1 },
        ...ADDON_KEYS.filter(key => quantities[key] > 0).map(key => ({ price: priceIdForAddon(key, interval), quantity: quantities[key] })),
    ]
}

export type PlanCheckoutSession = { clientSecret: string; sessionId: string; trial: boolean }

export async function createPlanCheckoutSession(selection: PlanSelection): Promise<PlanCheckoutSession> {
    assertValidSelection(selection)
    const { params, priceArm } = await basePlanCheckoutParams()
    const trial = !!params.subscription_data?.trial_period_days

    const checkout = await stripe.checkout.sessions.create({
        ...params,
        line_items: planLineItems(trial ? CARD_TRIAL_SELECTION : selection, priceArm),
        metadata: { ...params.metadata, ...(trial ? { [CARD_TRIAL_METADATA_KEY]: '1' } : {}) },
        billing_address_collection: 'required',
        ui_mode: 'elements',
        return_url: `${await getAppOrigin()}/?billing=success`,
    })

    if (!checkout.client_secret) throw new Error('Stripe did not return a checkout secret')
    return { clientSecret: checkout.client_secret, sessionId: checkout.id, trial }
}

async function requireOpenPlanSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    const workspaceId = await requireWorkspaceId()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.metadata?.workspace_id !== String(workspaceId)) throw new AppError('checkoutOtherWorkspace')
    if (session.status !== 'open') throw new AppError('checkoutClosed')
    return session
}

export async function updatePlanCheckoutSession(sessionId: string, selection: PlanSelection): Promise<void> {
    assertValidSelection(selection)
    const session = await requireOpenPlanSession(sessionId)
    if (session.mode !== 'subscription') throw new AppError('checkoutNotPlan')
    if (session.metadata?.[CARD_TRIAL_METADATA_KEY]) throw new AppError('trialPlanLocked')

    const { data: workspace } = await selectSingle(createServiceRoleClient(), 'workspaces', ['price_arm'] as const, { id: Number(session.metadata?.workspace_id) })
    await stripe.checkout.sessions.update(sessionId, { line_items: planLineItems(selection, parsePriceArm(workspace?.price_arm)) })
}

export async function acceptPlanTerms(sessionId: string): Promise<void> {
    await requireOpenPlanSession(sessionId)
    await stripe.checkout.sessions.update(sessionId, { metadata: { [TERMS_ACCEPTED_METADATA_KEY]: new Date().toISOString() } })
}

export type CheckoutOutcome = { state: 'entitled' | 'trial_refused' | 'pending' }

export async function readCheckoutOutcome(sessionId: string): Promise<CheckoutOutcome> {
    const workspaceId = await requireWorkspaceId()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.metadata?.workspace_id !== String(workspaceId)) throw new AppError('checkoutOtherWorkspace')

    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['subscription_status', 'trial_ends_at'] as const, { id: workspaceId })
    if (isSubscriptionEntitled(workspace?.subscription_status)) return { state: 'entitled' }

    if (session.status === 'complete' && workspace?.trial_ends_at) return { state: 'trial_refused' }
    return { state: 'pending' }
}

const LIVE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due', 'unpaid'])

async function refuseSecondPlanSubscription(workspaceId: number, customerId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['stripe_subscription_id'] as const, { id: workspaceId })

    if (workspace?.stripe_subscription_id) {
        const current = await stripe.subscriptions.retrieve(workspace.stripe_subscription_id).catch(() => null)
        if (current && LIVE_SUBSCRIPTION_STATUSES.has(current.status)) throw new AppError('alreadySubscribed')
    }

    const { data: subscriptions } = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    if (subscriptions.some(subscription => !isTemplateSubscription(subscription) && LIVE_SUBSCRIPTION_STATUSES.has(subscription.status))) {
        throw new AppError('alreadySubscribed')
    }
}

export async function createPlanCardSetupSession(): Promise<{ clientSecret: string; sessionId: string }> {
    const { workspaceId, subscription } = await requireEditablePlanSubscription({ allowPastDue: true })

    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    await ensureCustomerEmail(customerId)
    const checkout = await stripe.checkout.sessions.create({
        mode: 'setup',
        customer: customerId,
        currency: PLAN_CURRENCY,
        payment_method_types: PLAN_PAYMENT_METHOD_TYPES,
        billing_address_collection: 'required',
        customer_update: { address: 'auto', name: 'auto' },
        tax_id_collection: { enabled: true },
        metadata: {
            kind: PLAN_CARD_SETUP_KIND,
            workspace_id: String(workspaceId),
            subscription_id: subscription.id,
        },
        ui_mode: 'elements',
        return_url: `${await getAppOrigin()}/?billing=1`,
    })

    if (!checkout.client_secret) throw new Error('Stripe did not return a checkout secret')
    return { clientSecret: checkout.client_secret, sessionId: checkout.id }
}

function parsePlanSelection(raw: string | undefined): PlanSelection | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as PlanSelection
        const quantities = Object.fromEntries(ADDON_KEYS.map(key => [key, parsed.quantities?.[key] ?? ZERO_QUANTITIES[key]])) as AddonQuantities
        const selection = { quantities, interval: parsed.interval }
        assertValidSelection(selection)
        return selection
    } catch {
        return null
    }
}

export async function completeCardSetupSession(session: Stripe.Checkout.Session): Promise<void> {
    await applyCardSetupSession(session)

    const { subscription } = await requireEditablePlanSubscription({ allowPastDue: true })
    if (subscription.status === 'past_due') await payOpenInvoice(subscription, await checkoutPaymentMethodId(session, subscription))
}

async function payOpenInvoice(subscription: Stripe.Subscription, paymentMethodId: string | null): Promise<void> {
    const { data: open } = await stripe.invoices.list({ subscription: subscription.id, status: 'open', limit: 1 })
    const invoice = open[0]
    if (!invoice?.id) return
    await stripe.invoices.pay(invoice.id, paymentMethodId ? { payment_method: paymentMethodId } : {})
}

export async function applyCardSetupSession(session: Stripe.Checkout.Session): Promise<void> {
    const subscriptionId = session.metadata?.subscription_id
    if (!subscriptionId) return

    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    if (subscription.status === 'canceled') return

    const paymentMethodId = await checkoutPaymentMethodId(session, subscription)
    if (paymentMethodId) await stripe.subscriptions.update(subscription.id, { default_payment_method: paymentMethodId })
    await adoptCheckoutPaymentMethodAsDefault(session, subscription)
    await enableAutomaticTaxOnPlanSubscription(subscription.id)
}

async function enableAutomaticTaxOnPlanSubscription(subscriptionId: string): Promise<void> {
    try {
        await stripe.subscriptions.update(subscriptionId, { automatic_tax: { enabled: true } })
    } catch (err) {
        console.error('[billing] could not enable automatic tax after card setup', err)
    }
}

export type SavedCard = { brand: string; last4: string; expMonth: number; expYear: number }

export type SubscriptionState = {
    entitled: boolean
    status: Stripe.Subscription.Status
    quantities: AddonQuantities
    interval: BillingInterval
    priceArm: PriceArm
    pendingSwitch: { selection: PlanSelection; at: string } | null
    monthlyDiscountCents: number
    pendingDowngrade: Partial<Pick<WorkspaceLimitColumns, 'rerun_budget_micros'>>
    periodEnd: string | null
    card: SavedCard | null
    nextInvoice: { at: string; amountCents: number } | null
    openInvoice: { amountCents: number; createdAt: string } | null
    hasPaymentMethod: boolean
    cancelAtPeriodEnd: boolean
    cancelPhase: CancelPhase | null
    retentionOffer: RetentionOfferKind | null
    business: BusinessDetails
}

function permanentCouponCents(coupon: Stripe.Coupon | null): number {
    if (!coupon || coupon.duration !== 'forever' || coupon.currency !== PLAN_CURRENCY) return 0
    return coupon.amount_off ?? 0
}

function permanentDiscountCents(subscription: Stripe.Subscription): number {
    return (subscription.discounts ?? []).reduce((sum, discount) => {
        const coupon = typeof discount === 'string' ? null : discount.source?.coupon
        return sum + permanentCouponCents(!coupon || typeof coupon === 'string' ? null : coupon)
    }, 0)
}

export async function getSubscriptionState(): Promise<SubscriptionState | null> {
    const workspaceId = await requireWorkspaceId()
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(
        supabase,
        'workspaces',
        ['stripe_subscription_id', 'subscription_status', 'current_period_end', 'rerun_budget_micros'] as const,
        { id: workspaceId },
    )
    if (!workspace?.stripe_subscription_id) return null

    const subscription = await stripe.subscriptions.retrieve(workspace.stripe_subscription_id, {
        expand: ['discounts.source.coupon', 'customer.invoice_settings.default_payment_method', 'customer.tax_ids', 'default_payment_method'],
    })
    const { hasBase, quantities } = quantitiesFromItems(subscription.items.data)
    if (!hasBase) return null

    const customer = typeof subscription.customer === 'string' || subscription.customer.deleted ? null : subscription.customer
    const paymentMethod = subscription.default_payment_method ?? customer?.invoice_settings?.default_payment_method ?? null
    const hasPaymentMethod = !!paymentMethod

    const derived = quantitiesToColumns(quantities)
    const pendingDowngrade: SubscriptionState['pendingDowngrade'] = {}
    if (subscription.status !== 'trialing' && workspace.rerun_budget_micros > derived.rerun_budget_micros) pendingDowngrade.rerun_budget_micros = derived.rerun_budget_micros

    const [pendingSwitch, nextInvoice, openInvoice] = await Promise.all([
        readPendingSwitch(subscription),
        subscription.cancel_at_period_end ? null : readNextInvoice(subscription),
        subscription.status === 'past_due' ? readOpenInvoice(subscription) : null,
    ])

    return {
        entitled: subscription.status === 'active' || subscription.status === 'trialing',
        status: subscription.status,
        quantities,
        interval: intervalOfItems(subscription.items.data),
        priceArm: priceArmOfItems(subscription.items.data),
        pendingSwitch,
        monthlyDiscountCents: permanentDiscountCents(subscription) + legacyBaseDiscountCents(subscription.items.data),
        pendingDowngrade,
        periodEnd: workspace.current_period_end,
        card: savedCard(paymentMethod),
        nextInvoice,
        openInvoice,
        hasPaymentMethod,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        cancelPhase: cancelFlowPhase(subscription.status, hasPaymentMethod),
        retentionOffer: pendingRetentionOffer(subscription),
        business: businessDetailsOf(customer),
    }
}

function savedCard(paymentMethod: string | Stripe.PaymentMethod | null): SavedCard | null {
    if (!paymentMethod || typeof paymentMethod === 'string' || !paymentMethod.card) return null
    const { brand, last4, exp_month, exp_year } = paymentMethod.card
    return { brand, last4, expMonth: exp_month, expYear: exp_year }
}

async function readNextInvoice(subscription: Stripe.Subscription): Promise<SubscriptionState['nextInvoice']> {
    try {
        const invoice = await stripe.invoices.createPreview({ subscription: subscription.id })
        const at = stripeTimestampIso(invoice.next_payment_attempt ?? invoice.period_end)
        return at ? { at, amountCents: invoice.amount_due } : null
    } catch (err) {
        console.error('[billing] could not preview the next invoice', err)
        return null
    }
}

async function readOpenInvoice(subscription: Stripe.Subscription): Promise<SubscriptionState['openInvoice']> {
    const { data } = await stripe.invoices.list({ subscription: subscription.id, status: 'open', limit: 1 })
    const invoice = data[0]
    return invoice ? { amountCents: invoice.amount_due, createdAt: new Date(invoice.created * 1000).toISOString() } : null
}

export type InvoiceSummary = { id: string; createdAt: string; amountCents: number; status: string; pdfUrl: string | null; hostedUrl: string | null }

export async function listInvoices(): Promise<InvoiceSummary[]> {
    const workspaceId = await requireWorkspaceId()
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['stripe_customer_id'] as const, { id: workspaceId })
    if (!workspace?.stripe_customer_id) return []

    const { data } = await stripe.invoices.list({ customer: workspace.stripe_customer_id, limit: 12 })
    return data
        .filter(invoice => invoice.id && invoice.status !== 'draft' && invoice.status !== 'void')
        .map(invoice => ({
            id: invoice.id!,
            createdAt: new Date(invoice.created * 1000).toISOString(),
            amountCents: invoice.total,
            status: invoice.status ?? 'open',
            pdfUrl: invoice.invoice_pdf ?? null,
            hostedUrl: invoice.hosted_invoice_url ?? null,
        }))
}

export type BusinessTaxId = { type: TaxIdType; value: string; status: TaxIdStatus | null }

export type BusinessDetails = { name: string | null; country: string | null; taxId: BusinessTaxId | null }

function customerTaxIds(customer: Stripe.Customer): Stripe.TaxId[] {
    return customer.tax_ids?.data ?? []
}

function businessDetailsOf(customer: Stripe.Customer | null): BusinessDetails {
    if (!customer) return { name: null, country: null, taxId: null }
    const taxId = customerTaxIds(customer).find(id => id.type !== 'unknown')
    return {
        name: customer.name ?? null,
        country: customer.address?.country ?? null,
        taxId: taxId ? { type: taxId.type as TaxIdType, value: taxId.value, status: taxId.verification?.status ?? null } : null,
    }
}

async function requireBillingCustomer(): Promise<Stripe.Customer> {
    const workspaceId = await requireWorkspaceId()
    const { data: workspace } = await selectSingle(createServiceRoleClient(), 'workspaces', ['stripe_customer_id'] as const, { id: workspaceId })
    if (!workspace?.stripe_customer_id) throw new AppError('noBillingAccount')
    const customer = await stripe.customers.retrieve(workspace.stripe_customer_id, { expand: ['tax_ids'] })
    if (customer.deleted) throw new AppError('billingAccountClosed')
    return customer
}

function countryName(country: string): string {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(country) ?? country
}

function isInvalidTaxIdError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'tax_id_invalid'
}

export type BusinessDetailsInput = { name: string; type: TaxIdType; value: string }

export async function saveBusinessDetails(input: BusinessDetailsInput): Promise<BusinessDetails> {
    const customer = await requireBillingCustomer()
    const country = customer.address?.country
    if (!country) throw new AppError('addCardBeforeTaxId')
    if (!taxIdTypesFor(country).includes(input.type)) throw new AppError('taxIdTypeMismatch', { country: countryName(country) })

    const value = normalizeTaxIdValue(input.type, input.value, country)
    const existing = customerTaxIds(customer)
    let kept = existing.find(id => id.type === input.type && id.value === value)
    if (!kept) {
        try {
            kept = await stripe.customers.createTaxId(customer.id, { type: input.type, value })
        } catch (err) {
            if (isInvalidTaxIdError(err)) throw new AppError('taxIdInvalid', { country: countryName(country) })
            throw err
        }
    }
    const keptId = kept.id
    await Promise.all(existing.filter(id => id.id !== keptId).map(id => stripe.customers.deleteTaxId(customer.id, id.id)))

    const name = input.name.trim()
    if (name !== customer.name) await stripe.customers.update(customer.id, { name })

    return {
        name,
        country,
        taxId: { type: input.type, value: kept.value, status: kept.verification?.status ?? null },
    }
}

export async function removeTaxId(): Promise<void> {
    const customer = await requireBillingCustomer()
    await Promise.all(customerTaxIds(customer).map(id => stripe.customers.deleteTaxId(customer.id, id.id)))
}

function pendingRetentionOffer(subscription: Stripe.Subscription): RetentionOfferKind | null {
    for (const discount of subscription.discounts ?? []) {
        const coupon = typeof discount === 'string' ? null : discount.source?.coupon
        const kind = retentionOfferOfCoupon(typeof coupon === 'string' ? coupon : coupon?.id)
        if (kind) return kind
    }
    return null
}

type PlanItemChange = { id?: string; price?: string; quantity?: number; deleted?: boolean }

function planItemChanges(subscription: Stripe.Subscription, target: AddonQuantities): { increases: PlanItemChange[]; decreases: PlanItemChange[]; endingTrial: boolean } {
    const { quantities: current } = quantitiesFromItems(subscription.items.data)
    const interval = intervalOfItems(subscription.items.data)

    const itemIdByAddon = new Map<string, string>()
    for (const item of subscription.items.data) {
        const addon = addonForPriceId(item.price?.id)
        if (addon) itemIdByAddon.set(addon, item.id)
    }

    const increases: PlanItemChange[] = []
    const decreases: PlanItemChange[] = []
    for (const key of ADDON_KEYS) {
        if (target[key] === current[key]) continue
        const existingItemId = itemIdByAddon.get(key)
        const item: PlanItemChange = existingItemId
            ? target[key] === 0
                ? { id: existingItemId, deleted: true }
                : { id: existingItemId, quantity: target[key] }
            : { price: priceIdForAddon(key, interval), quantity: target[key] }
        ;(target[key] > current[key] ? increases : decreases).push(item)
    }

    return { increases, decreases, endingTrial: subscription.status === 'trialing' && increases.length > 0 }
}

async function requireEditablePlanSubscription({ allowPastDue = false }: { allowPastDue?: boolean } = {}): Promise<{ workspaceId: number; subscription: Stripe.Subscription }> {
    const workspaceId = await requireWorkspaceId()
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['stripe_subscription_id', 'subscription_status'] as const, { id: workspaceId })

    if (!workspace?.stripe_subscription_id) throw new AppError('noActiveSubscription')
    const editable = workspace.subscription_status === 'active' || workspace.subscription_status === 'trialing' || (allowPastDue && workspace.subscription_status === 'past_due')
    if (!editable) throw new AppError('subscriptionNotActive')

    const subscription = await stripe.subscriptions.retrieve(workspace.stripe_subscription_id)
    if (isTemplateSubscription(subscription)) throw new AppError('noPlanSubscription')
    const { hasBase } = quantitiesFromItems(subscription.items.data)
    if (!hasBase) throw new AppError('noPlanSubscription')

    return { workspaceId, subscription }
}

function assertValidQuantities(target: AddonQuantities): void {
    for (const key of ADDON_KEYS) {
        if (!Number.isInteger(target[key]) || target[key] < 0) throw new AppError('invalidAddonQuantity')
    }
}

export type PlanChangePreview = {
    dueTodayCents: number
    taxCents: number
    taxIncluded: boolean
    nextRenewalIso: string | null
}

function isProrationLine(line: Stripe.InvoiceLineItem): boolean {
    return !!(line.parent?.subscription_item_details?.proration || line.parent?.invoice_item_details?.proration)
}

function lineTaxCents(line: Stripe.InvoiceLineItem): number {
    return (line.taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0)
}

export async function previewSubscriptionUpdate(target: AddonQuantities): Promise<PlanChangePreview | null> {
    assertValidQuantities(target)
    const { subscription } = await requireEditablePlanSubscription()
    const { increases, endingTrial } = planItemChanges(subscription, target)
    if (increases.length === 0) return null

    const invoice = await stripe.invoices.createPreview({
        subscription: subscription.id,
        subscription_details: {
            items: increases,
            proration_behavior: endingTrial ? 'none' : 'always_invoice',
            ...(endingTrial ? { trial_end: 'now' as const } : {}),
        },
    })

    if (endingTrial) return trialEndPreview(invoice, subscription)

    const taxIncluded = subscription.automatic_tax?.enabled ?? true
    const prorations = invoice.lines.data.filter(isProrationLine)
    if (prorations.length === 0) return null

    const amountCents = prorations.reduce((sum, line) => sum + line.amount, 0)
    const taxCents = prorations.reduce((sum, line) => sum + lineTaxCents(line), 0)
    return {
        dueTodayCents: amountCents + taxCents,
        taxCents,
        taxIncluded,
        nextRenewalIso: subscriptionPeriodEndIso(subscription),
    }
}

function trialEndPreview(invoice: Stripe.Invoice, subscription: Stripe.Subscription): PlanChangePreview {
    const taxCents = (invoice.total_taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0)
    return {
        dueTodayCents: invoice.amount_due,
        taxCents,
        taxIncluded: subscription.automatic_tax?.enabled ?? true,
        nextRenewalIso: subscriptionPeriodEndIso(subscription),
    }
}

export async function extendTrial(subscriptionId: string, days: number, idempotencyKey: string): Promise<boolean> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    if (subscription.status !== 'trialing' || !subscription.trial_end) return false

    await stripe.subscriptions.update(subscription.id, { trial_end: subscription.trial_end + days * 86_400, proration_behavior: 'none' }, { idempotencyKey })
    return true
}

function trialConversionState(subscription: Stripe.Subscription, hasPaymentMethod: boolean): { status: string; hasPaymentMethod: boolean; cancelAtPeriodEnd: boolean } {
    return { status: subscription.status, hasPaymentMethod, cancelAtPeriodEnd: subscription.cancel_at_period_end }
}

export type CancelFlowOffer = {
    kind: RetentionOfferKind
    priceCents: number
    fullPriceCents: number
    basePriceCents: number
    billedOn: string
    fullPriceFrom: string
}

export type CancelFlowState = {
    now: string
    phase: CancelPhase
    endsAt: string
    keptUntil: string
    reminderAt: string | null
    paidLeftCents: number
    offer: CancelFlowOffer | null
}

const DAY_MS = 24 * 60 * 60_000

type CancellableSubscription = { workspaceId: number; subscription: Stripe.Subscription; phase: CancelPhase; endsAt: Date }

async function requireCancellableSubscription(): Promise<CancellableSubscription> {
    const { workspaceId, subscription } = await requireEditablePlanSubscription()
    const phase = cancelFlowPhase(subscription.status, await subscriptionHasPaymentMethod(subscription))
    if (!phase) throw new AppError('trialNothingToCancel')

    const endsAtIso = phase === 'trial' ? stripeTimestampIso(subscription.trial_end) : subscriptionPeriodEndIso(subscription)
    if (!endsAtIso) throw new AppError('readBillingPeriodFailed')
    return { workspaceId, subscription, phase, endsAt: new Date(endsAtIso) }
}

function planPeriodCents(subscription: Stripe.Subscription): number {
    const { quantities } = quantitiesFromItems(subscription.items.data)
    return planPriceCents(quantities, intervalOfItems(subscription.items.data), priceArmOfItems(subscription.items.data)) - legacyBaseDiscountCents(subscription.items.data)
}

function retentionOfferOf({ subscription, phase }: CancellableSubscription): RetentionOfferKind | null {
    if (intervalOfItems(subscription.items.data) === 'yearly') return null
    return retentionOfferFor(phase, {
        metadata: subscription.metadata,
        discountCount: subscription.discounts?.length ?? 0,
        legacyBase: legacyBaseDiscountCents(subscription.items.data) > 0,
    })
}

function periodStartOf(subscription: Stripe.Subscription): Date | null {
    const start = subscription.items.data.find(item => isBasePriceId(item.price?.id))?.current_period_start
    return start ? new Date(start * 1000) : null
}

export async function getCancelFlowState(): Promise<CancelFlowState> {
    const cancellable = await requireCancellableSubscription()
    const { subscription, phase, endsAt } = cancellable
    if (subscription.cancel_at_period_end) throw new AppError('alreadyCancelling')

    const now = new Date()
    const monthlyCents = planPeriodCents(subscription)
    const periodStart = periodStartOf(subscription)
    const kind = retentionOfferOf(cancellable)
    const priceArm = priceArmOfItems(subscription.items.data)

    return {
        now: now.toISOString(),
        phase,
        endsAt: endsAt.toISOString(),
        keptUntil: new Date(endsAt.getTime() + (phase === 'trial' ? BOX_DELETION_GRACE_MS : 0) + ARCHIVE_RETENTION_DAYS * DAY_MS).toISOString(),
        reminderAt: reminderDate(phase, endsAt, now)?.toISOString() ?? null,
        paidLeftCents: phase === 'paid' && periodStart ? paidLeftCents(monthlyCents, periodStart, endsAt, now) : 0,
        offer: kind
            ? {
                  kind,
                  priceCents: offerPriceCents(kind, monthlyCents, priceArm),
                  fullPriceCents: monthlyCents,
                  basePriceCents: basePriceCents(priceArm),
                  billedOn: endsAt.toISOString(),
                  fullPriceFrom: addOneMonth(endsAt).toISOString(),
              }
            : null,
    }
}

export async function cancelSubscription(input: { reason: CancelReason; comeback: CancelComeback; comment: string; check: CancelReasonCheck }): Promise<void> {
    const { subscription: loaded } = await requireCancellableSubscription()
    if (loaded.cancel_at_period_end) return
    const subscription = await releasePendingSwitch(loaded)

    await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
        cancellation_details: { feedback: input.reason, comment: input.comment },
        metadata: { [CANCEL_COMEBACK_METADATA_KEY]: input.comeback, [CANCEL_REASON_CHECK_METADATA_KEY]: input.check },
    })
}

export async function resumeSubscription(): Promise<void> {
    const { subscription } = await requireEditablePlanSubscription()
    if (!subscription.cancel_at_period_end) return

    await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: false })
}

async function ensureRetentionCoupon(kind: RetentionOfferKind, subscription: Stripe.Subscription): Promise<string> {
    const priceArm = priceArmOfItems(subscription.items.data)
    const id = retentionCouponId(kind, priceArm)
    try {
        return (await stripe.coupons.retrieve(id)).id
    } catch (err) {
        if ((err as { code?: string }).code !== 'resource_missing') throw err
    }

    if (kind === 'trial_half') return (await stripe.coupons.create({ id, ...retentionCouponParams(kind, priceArm) })).id

    const product = subscription.items.data.find(item => isBasePriceId(item.price?.id))?.price.product
    if (!product) throw new AppError('noPlanSubscription')
    const productId = typeof product === 'string' ? product : product.id
    return (await stripe.coupons.create({ id, ...retentionCouponParams(kind, priceArm), applies_to: { products: [productId] } })).id
}

export async function claimRetentionOffer(): Promise<RetentionOfferKind> {
    const cancellable = await requireCancellableSubscription()
    const { subscription } = cancellable
    const kind = retentionOfferOf(cancellable)
    if (!kind) throw new AppError('offerUnavailable')

    const coupon = await ensureRetentionCoupon(kind, subscription)
    await stripe.subscriptions.update(
        subscription.id,
        {
            discounts: [{ coupon }],
            metadata: { [RETENTION_CLAIMED_METADATA_KEY]: new Date().toISOString() },
        },
        { idempotencyKey: `retention-offer:${subscription.id}` },
    )
    return kind
}

export async function requestRenewalReminder(): Promise<string> {
    const { workspaceId, phase, endsAt } = await requireCancellableSubscription()
    if (phase !== 'paid') throw new AppError('onlyPaidPlanRenews')

    const at = reminderDate(phase, endsAt, new Date())
    if (!at) throw new AppError('renewsTooSoon')

    const { user } = await getSessionWorkspace()
    if (!user?.id) throw new AppError('notAuthenticated')

    const supabase = createServiceRoleClient()
    const { error } = await supabase
        .from('workspaces')
        .update<WorkspaceUpdate>({ renewal_reminder_at: at.toISOString(), renewal_reminder_user_id: user.id })
        .eq('id', workspaceId)
    if (error) throw error
    return at.toISOString()
}

function replacementItems(subscription: Stripe.Subscription, { quantities, interval }: PlanSelection): PlanItemChange[] {
    const priceArm = priceArmOfItems(subscription.items.data)
    const changes: PlanItemChange[] = []
    const kept = new Set<string>()
    for (const item of subscription.items.data) {
        const priceId = item.price?.id
        if (isBasePriceId(priceId)) {
            changes.push({ id: item.id, price: basePriceId(interval, priceArm), quantity: 1 })
            continue
        }
        const addon = addonForPriceId(priceId)
        if (addon && quantities[addon] > 0 && !kept.has(addon)) {
            kept.add(addon)
            changes.push({ id: item.id, price: priceIdForAddon(addon, interval), quantity: quantities[addon] })
            continue
        }
        if (addon || isLegacyPlanItemPriceId(priceId)) changes.push({ id: item.id, deleted: true })
    }
    for (const key of ADDON_KEYS) {
        if (quantities[key] > 0 && !kept.has(key)) changes.push({ price: priceIdForAddon(key, interval), quantity: quantities[key] })
    }
    return changes
}

export type PlanChangeKind = 'end_trial' | 'same_interval' | 'switch_now' | 'switch_at_renewal'

export function planChangeKind(status: string, current: BillingInterval, target: BillingInterval): PlanChangeKind {
    if (status === 'trialing') return 'end_trial'
    if (current === target) return 'same_interval'
    return target === 'yearly' ? 'switch_now' : 'switch_at_renewal'
}

export type PlanChangeResult = { trialEnded: boolean; switchAt: string | null; paymentClientSecret: string | null }

const PLAN_CHANGE_AFTER_PAYMENT_KEY = 'plan_change_after_payment'

async function updateWithPayment(subscriptionId: string, params: Stripe.SubscriptionUpdateParams, afterPayment: PlanSelection | null = null): Promise<string | null> {
    const updated = await stripe.subscriptions.update(subscriptionId, {
        ...params,
        ...(afterPayment ? { metadata: { [PLAN_CHANGE_AFTER_PAYMENT_KEY]: JSON.stringify(afterPayment) } } : {}),
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice.confirmation_secret'],
    })
    if (!updated.pending_update) return null
    const invoice = typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null
    const clientSecret = invoice?.confirmation_secret?.client_secret
    if (!clientSecret) throw new AppError('chargeRefused')
    await assertPaymentAwaitsConfirmation(clientSecret)
    return clientSecret
}

async function assertPaymentAwaitsConfirmation(clientSecret: string): Promise<void> {
    const intent = await stripe.paymentIntents.retrieve(clientSecret.split('_secret_')[0]!)
    if (intent.status === 'requires_action') return
    const refusal = intent.last_payment_error
    throw refusal?.type === 'card_error' && refusal.message ? new Error(refusal.message) : new AppError('chargeRefused')
}

async function assertSlotRemovalLeavesConnections(workspaceId: number, subscription: Stripe.Subscription, target: AddonQuantities): Promise<void> {
    const { quantities: current } = quantitiesFromItems(subscription.items.data)
    const supabase = createServiceRoleClient()
    for (const slug of APP_SLUGS) {
        const addonKey = APP_ADDON_KEYS[slug]
        if (target[addonKey] >= current[addonKey]) continue
        const [{ data: connections }, { data: app }] = await Promise.all([
            selectMany(supabase, 'app_connections', ['status', 'pause_reason'] as const, { workspace_id: workspaceId, app_slug: slug, status: [...SLOT_HOLDING_STATUSES] }),
            selectMaybeSingle(supabase, 'workspace_apps', ['trial_ends_at', 'trial_settled_at'] as const, { workspace_id: workspaceId, app_slug: slug }),
        ])
        const onPaidSlots = (connections ?? []).filter(connection => !(connection.status === 'paused' && (SLOT_PAUSE_REASONS as readonly string[]).includes(connection.pause_reason ?? ''))).length - (subscriberTrialOpen(app) ? 1 : 0)
        const { name, providerLabel } = APP_INFO[slug]
        if (target[addonKey] < onPaidSlots) throw new AppError('disconnectBeforeSlotRemoval', { provider: providerLabel, app: name })
    }
}

export async function changePlan(selection: PlanSelection): Promise<PlanChangeResult> {
    assertValidSelection(selection)
    const { workspaceId, subscription: loaded } = await requireEditablePlanSubscription()
    await assertSlotRemovalLeavesConnections(workspaceId, loaded, selection.quantities)
    const subscription = await releasePendingSwitch(loaded)
    const kind = planChangeKind(subscription.status, intervalOfItems(subscription.items.data), selection.interval)

    if (kind === 'end_trial') {
        await assertTrialConvertible(subscription)
        const paymentClientSecret = await updateWithPayment(subscription.id, {
            items: replacementItems(subscription, selection),
            trial_end: 'now',
            proration_behavior: 'none',
        })
        return { trialEnded: true, switchAt: null, paymentClientSecret }
    }

    if (kind === 'switch_now') {
        await assertPaymentMethod(subscription)
        const paymentClientSecret = await updateWithPayment(subscription.id, {
            items: replacementItems(subscription, selection),
            proration_behavior: 'always_invoice',
        })
        return { trialEnded: false, switchAt: null, paymentClientSecret }
    }

    const { increases, decreases } = planItemChanges(subscription, selection.quantities)
    const finishesLater = decreases.length > 0 || kind === 'switch_at_renewal'
    let paymentClientSecret: string | null = null
    if (increases.length > 0) {
        await assertPaymentMethod(subscription)
        paymentClientSecret = await updateWithPayment(subscription.id, { items: increases, proration_behavior: 'always_invoice' }, finishesLater ? selection : null)
    }
    if (paymentClientSecret) return { trialEnded: false, switchAt: kind === 'same_interval' ? null : subscriptionPeriodEndIso(subscription), paymentClientSecret }

    const switchAt = await finishPlanChange(subscription, selection, { clearAfterPayment: finishesLater && increases.length > 0 })
    return { trialEnded: false, switchAt, paymentClientSecret: null }
}

async function finishPlanChange(subscription: Stripe.Subscription, selection: PlanSelection, { clearAfterPayment }: { clearAfterPayment: boolean }): Promise<string | null> {
    const { decreases } = planItemChanges(subscription, selection.quantities)
    if (decreases.length > 0 || clearAfterPayment) {
        await stripe.subscriptions.update(subscription.id, {
            ...(decreases.length > 0 ? { items: decreases } : {}),
            proration_behavior: 'none',
            ...(clearAfterPayment ? { metadata: { [PLAN_CHANGE_AFTER_PAYMENT_KEY]: '' } } : {}),
        })
    }

    if (planChangeKind(subscription.status, intervalOfItems(subscription.items.data), selection.interval) !== 'switch_at_renewal') return null
    if (subscription.schedule) return subscriptionPeriodEndIso(subscription)
    const refreshed = await stripe.subscriptions.retrieve(subscription.id)
    return scheduleIntervalSwitch(refreshed, selection)
}

export async function finishPendingPlanChange(subscription: Stripe.Subscription): Promise<void> {
    if (isTemplateSubscription(subscription)) return
    const live = await stripe.subscriptions.retrieve(subscription.id)
    const selection = parsePlanSelection(live.metadata?.[PLAN_CHANGE_AFTER_PAYMENT_KEY])
    if (!selection) return
    await finishPlanChange(live, selection, { clearAfterPayment: false })
    await stripe.subscriptions.update(live.id, { metadata: { [PLAN_CHANGE_AFTER_PAYMENT_KEY]: '' } })
}

async function assertPaymentMethod(subscription: Stripe.Subscription): Promise<void> {
    if (!(await subscriptionHasPaymentMethod(subscription))) throw new AppError('addPaymentMethodFirst')
}

async function assertTrialConvertible(subscription: Stripe.Subscription): Promise<void> {
    const state = trialConversionState(subscription, await subscriptionHasPaymentMethod(subscription))
    if (canEndTrialNow(state)) return
    if (state.status !== 'trialing') throw new AppError('subscriptionAlreadyActive')
    if (state.cancelAtPeriodEnd) throw new AppError('resumeBeforeConverting')
    throw new AppError('addPaymentMethodFirst')
}

function scheduleDiscountParam(discount: Stripe.SubscriptionSchedule.Phase.Discount): Stripe.SubscriptionScheduleUpdateParams.Phase.Discount | null {
    const idOf = (ref: unknown): string | null => (typeof ref === 'string' ? ref : ref && typeof ref === 'object' && 'id' in ref && typeof ref.id === 'string' ? ref.id : null)
    const existing = idOf(discount.discount)
    if (existing) return { discount: existing }
    const promotionCode = idOf(discount.promotion_code)
    if (promotionCode) return { promotion_code: promotionCode }
    const coupon = idOf(discount.coupon)
    return coupon ? { coupon } : null
}

async function scheduleIntervalSwitch(subscription: Stripe.Subscription, selection: PlanSelection): Promise<string> {
    const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id })
    const current = schedule.phases[0]
    if (!current) throw new AppError('readCurrentBillingPeriodFailed')

    await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        phases: [
            {
                items: current.items.map(item => ({ price: typeof item.price === 'string' ? item.price : item.price.id, quantity: item.quantity })),
                discounts: (current.discounts ?? []).flatMap(discount => scheduleDiscountParam(discount) ?? []),
                start_date: current.start_date,
                end_date: current.end_date,
            },
            { items: planLineItems(selection, priceArmOfItems(subscription.items.data)), duration: { interval: 'month', interval_count: 1 }, proration_behavior: 'none' },
        ],
    })
    return new Date(current.end_date * 1000).toISOString()
}

async function releasePendingSwitch(subscription: Stripe.Subscription): Promise<Stripe.Subscription> {
    if (!subscription.schedule) return subscription
    const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule.id
    await stripe.subscriptionSchedules.release(scheduleId)
    return stripe.subscriptions.retrieve(subscription.id)
}

async function readPendingSwitch(subscription: Stripe.Subscription): Promise<SubscriptionState['pendingSwitch']> {
    if (!subscription.schedule) return null
    const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule.id
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
    const next = schedule.phases.find(phase => phase.start_date > Date.now() / 1000)
    if (!next) return null

    const quantities: AddonQuantities = { ...ZERO_QUANTITIES }
    let interval: BillingInterval = 'monthly'
    for (const item of next.items) {
        const priceId = typeof item.price === 'string' ? item.price : item.price.id
        if (isYearlyBasePriceId(priceId)) interval = 'yearly'
        const addon = addonForPriceId(priceId)
        if (addon) quantities[addon] += item.quantity ?? 0
    }
    return { selection: { quantities, interval }, at: new Date(next.start_date * 1000).toISOString() }
}

export async function cancelPendingSwitch(): Promise<void> {
    const { subscription } = await requireEditablePlanSubscription()
    await releasePendingSwitch(subscription)
}

export type PlanQuote = PlanChangePreview & {
    kind: PlanChangeKind
    unusedCreditCents: number
}

export async function previewPlanChange(selection: PlanSelection): Promise<PlanQuote | null> {
    assertValidSelection(selection)
    const { subscription } = await requireEditablePlanSubscription()
    const kind = planChangeKind(subscription.status, intervalOfItems(subscription.items.data), selection.interval)

    if (kind === 'end_trial' || kind === 'switch_now') {
        const invoice = await stripe.invoices.createPreview({
            subscription: subscription.id,
            subscription_details: {
                items: replacementItems(subscription, selection),
                proration_behavior: kind === 'end_trial' ? 'none' : 'always_invoice',
                ...(kind === 'end_trial' ? { trial_end: 'now' as const } : {}),
            },
        })
        const unusedCreditCents = -invoice.lines.data.filter(line => isProrationLine(line) && line.amount < 0).reduce((sum, line) => sum + line.amount, 0)
        return { ...trialEndPreview(invoice, subscription), kind, unusedCreditCents }
    }

    const preview = await previewSubscriptionUpdate(selection.quantities)
    return preview ? { ...preview, kind, unusedCreditCents: 0 } : null
}

export async function subscriptionHasPaymentMethod(subscription: Stripe.Subscription): Promise<boolean> {
    if (subscription.default_payment_method) return true
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    const customer = await stripe.customers.retrieve(customerId)
    return !customer.deleted && !!customer.invoice_settings?.default_payment_method
}

export async function findWorkspaceId(subscription: Stripe.Subscription): Promise<number | null> {
    const fromMeta = subscription.metadata?.workspace_id
    if (fromMeta && !Number.isNaN(Number(fromMeta))) return Number(fromMeta)

    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'workspaces', ['id'] as const, { stripe_customer_id: customerId })
    return data?.id ?? null
}

async function ownsWorkspacePlan(workspaceId: number, subscription: Stripe.Subscription): Promise<boolean> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'workspaces', ['stripe_subscription_id'] as const, { id: workspaceId })
    const owns = isSameSubscription(data?.stripe_subscription_id, subscription.id)
    if (!owns) console.warn(`[billing] ignoring ${subscription.id} for workspace ${workspaceId}, which is billed on ${data?.stripe_subscription_id}`)
    return owns
}

export async function adoptCheckoutPaymentMethodAsDefault(session: Stripe.Checkout.Session, subscription: Stripe.Subscription): Promise<void> {
    try {
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
        const paymentMethodId = await checkoutPaymentMethodId(session, subscription)
        if (!customerId || !paymentMethodId) return

        await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } })
    } catch (err) {
        console.error('[billing] could not adopt the checkout card as the customer default', err)
    }
}

export async function checkoutPaymentMethodId(session: Stripe.Checkout.Session | undefined, subscription: Stripe.Subscription): Promise<string | null> {
    const fromSubscription = subscription.default_payment_method
    if (fromSubscription) return typeof fromSubscription === 'string' ? fromSubscription : fromSubscription.id

    if (!session?.setup_intent) return null
    const setupIntentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent.id
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
    if (!setupIntent.payment_method) return null
    return typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method.id
}

function maxLimit(a: number | null, b: number | null): number | null {
    if (a === null || b === null) return null
    return Math.max(a, b)
}

type ExistingWorkspaceRow = {
    current_period_end: string | null
    subscription_status: string | null
    max_agents: number | null
    max_seats: number | null
    rerun_budget_micros: number
}

export async function applySubscriptionToWorkspace(subscription: Stripe.Subscription, { adopt = true }: { adopt?: boolean } = {}): Promise<void> {
    if (isTemplateSubscription(subscription)) return

    const workspaceId = await findWorkspaceId(subscription)
    if (!workspaceId) return

    const { hasBase, quantities } = quantitiesFromItems(subscription.items?.data ?? [])
    if (!hasBase) return

    const supabase = createServiceRoleClient()
    const newPeriodEnd = subscriptionPeriodEndIso(subscription)

    const { data: existing } = await selectMaybeSingle(
        supabase,
        'workspaces',
        ['current_period_end', 'subscription_status', 'stripe_subscription_id', 'max_agents', 'max_seats', 'rerun_budget_micros'] as const,
        { id: workspaceId },
    )

    if (!adopt && !shouldAdoptSubscription({ id: existing?.stripe_subscription_id, status: existing?.subscription_status }, subscription.id)) {
        console.warn(`[billing] ignoring ${subscription.id} for workspace ${workspaceId}, which is billed on ${existing?.stripe_subscription_id}`)
        return
    }

    const derived = quantitiesToColumns(quantities)
    const advanced = hasPeriodAdvanced(existing?.current_period_end, newPeriodEnd)
    const limits = advanced || !existing ? derived : mergeHeldLimits(existing, derived)

    const trialEndsAt = stripeTimestampIso(subscription.trial_end)
    const trialStartedAt = stripeTimestampIso(subscription.trial_start)
    const update: WorkspaceUpdate = {
        stripe_subscription_id: subscription.id,
        stripe_price_id: subscription.items.data.find(item => isBasePriceId(item.price?.id))?.price.id ?? basePriceId(),
        subscription_status: subscription.status,
        current_period_end: newPeriodEnd,
        subscription_cancel_at: subscription.cancel_at ? stripeTimestampIso(subscription.cancel_at) : subscription.cancel_at_period_end ? newPeriodEnd : null,
        ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
        ...(trialStartedAt ? { trial_started_at: trialStartedAt } : {}),
        plan: BASE_PLAN_SLUG,
        ...limits,
        ...rerunPeriodUpdate(advanced, subscription.status, new Date().toISOString()),
    }

    if (subscription.status === 'trialing') update.rerun_budget_micros = existing?.rerun_budget_micros ?? 0

    if (subscription.status === 'trialing') update.max_agents = maxLimit(existing?.max_agents ?? TRIAL_ACTIVE_AGENTS, TRIAL_ACTIVE_AGENTS)

    const { error } = await supabase.from('workspaces').update<WorkspaceUpdate>(update).eq('id', workspaceId)
    if (error) throw error

    await syncWorkspaceAppSlots(supabase, workspaceId, quantities, { periodAdvanced: advanced })

    await requestAgentActivationSync(await reconcileAgentActivation(workspaceId))

    if (existing?.subscription_status === 'trialing' && subscription.status === 'active') {
        const { woken } = await wakePlanLimitedAgents(workspaceId)
        await requestAgentActivationSync(woken, { switchOn: true })
    }

    void syncEnginePlan(workspaceId)

    await reportSubscriptionTransition(subscription, workspaceId, existing?.subscription_status ?? null)

    if (subscription.status === 'trialing' && trialEndsAt) await sendTrialStartedReceipt(supabase, workspaceId, trialEndsAt, TRIAL_DAYS, subscription.trial_settings?.end_behavior?.missing_payment_method !== 'cancel')

    if (isMachineEntitled(subscription.status)) await requestBoxRestore(workspaceId)
}

export async function stampFirstPlanPayment(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.amount_paid || invoice.amount_paid <= 0) return

    const subscription = await subscriptionOfInvoice(invoice)
    if (!subscription || isTemplateSubscription(subscription)) return

    const workspaceId = await findWorkspaceId(subscription)
    if (!workspaceId) return
    if (!(await ownsWorkspacePlan(workspaceId, subscription))) return

    const supabase = createServiceRoleClient()
    const { data: existing } = await selectMaybeSingle(supabase, 'workspaces', ['first_paid_at'] as const, { id: workspaceId })
    if (existing?.first_paid_at) return

    const { error } = await supabase.from('workspaces').update<WorkspaceUpdate>({ first_paid_at: new Date().toISOString() }).eq('id', workspaceId)
    if (error) throw error

    await reportTrialConverted(subscription, workspaceId)
}

function mergeHeldLimits(existing: ExistingWorkspaceRow, derived: WorkspaceLimitColumns): WorkspaceLimitColumns {
    return {
        ...derived,
        max_agents: maxLimit(existing.max_agents, derived.max_agents),
        max_seats: maxLimit(existing.max_seats, derived.max_seats),
        rerun_budget_micros: Math.max(existing.rerun_budget_micros ?? 0, derived.rerun_budget_micros),
    }
}

export async function markSubscriptionCanceled(subscription: Stripe.Subscription): Promise<void> {
    if (isTemplateSubscription(subscription)) return
    const workspaceId = await findWorkspaceId(subscription)
    if (!workspaceId) return
    if (!(await ownsWorkspacePlan(workspaceId, subscription))) return
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('workspaces').update<WorkspaceUpdate>({ subscription_status: 'canceled' }).eq('id', workspaceId)
    if (error) throw error
    await requestAgentActivationSync(await reconcileAgentActivation(workspaceId))
    await reportSubscriptionCancelled(subscription, workspaceId)
}

function awaitsPendingUpdatePayment(subscription: Stripe.Subscription, invoice: Stripe.Invoice): boolean {
    if (!subscription.pending_update) return false
    const latestInvoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id
    return !!invoice.id && latestInvoiceId === invoice.id
}

export async function markSubscriptionPastDue(subscription: Stripe.Subscription, invoice: Stripe.Invoice): Promise<void> {
    if (isTemplateSubscription(subscription)) return
    if (awaitsPendingUpdatePayment(subscription, invoice)) return
    const workspaceId = await findWorkspaceId(subscription)
    if (!workspaceId) return
    if (!(await ownsWorkspacePlan(workspaceId, subscription))) return
    const supabase = createServiceRoleClient()
    const { data: existing } = await selectMaybeSingle(supabase, 'workspaces', ['subscription_status', 'first_paid_at'] as const, { id: workspaceId })
    const firstAttempt = invoice.attempt_count <= 1
    const { error } = await supabase
        .from('workspaces')
        .update<WorkspaceUpdate>({ subscription_status: 'past_due', ...(firstAttempt ? { payment_failed_at: new Date().toISOString() } : {}) })
        .eq('id', workspaceId)
    if (error) throw error
    if (existing?.subscription_status === 'trialing') await reportTrialPaymentFailed(subscription, workspaceId, invoice)
    if (firstAttempt) {
        await sendPaymentFailedNotice(supabase, workspaceId, {
            id: invoice.id ?? null,
            amountDueCents: invoice.amount_due,
            currency: invoice.currency,
            hostedUrl: invoice.hosted_invoice_url ?? null,
            firstCharge: !existing?.first_paid_at,
        })
    }
}
