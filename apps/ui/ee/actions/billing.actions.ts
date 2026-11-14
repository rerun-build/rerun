'use server'

import type { Database } from '@/app/api/database.types'
import { actorFromContext } from '@/app/api/_auth/access'
import { requireAdminContext, requireWorkspaceContext, requireWorkspaceId } from '@/app/api/_auth/ownership'
import {
    acceptPlanTerms,
    cancelPendingSwitch,
    cancelSubscription,
    changePlan,
    claimRetentionOffer,
    completeCardSetupSession,
    createPlanCardSetupSession,
    createPlanCheckoutSession,
    listInvoices,
    previewPlanChange,
    removeTaxId,
    saveBusinessDetails,
    type BusinessDetails,
    updatePlanCheckoutSession,
    type InvoiceSummary,
    type PlanChangeResult,
    type PlanCheckoutSession,
    type PlanQuote,
    type PlanSelection,
    getCancelFlowState,
    getSubscriptionState,
    readCheckoutOutcome,
    requestRenewalReminder,
    resumeSubscription,
    startCardlessTrial,
    PLAN_CARD_SETUP_KIND,
    type CancelFlowState,
    type CheckoutOutcome,
    type SubscriptionState,
} from '@/ee/services/billing.service'
import { loadCancelFlowActivity, type CancelFlowActivity } from '@/ee/services/cancel-flow-activity.service'
import { buyCredit, quoteCreditPurchase, type CreditPurchaseResult, type CreditQuote } from '@/ee/services/credit-purchase.service'
import { getCreditUsage } from '@/ee/services/credit-usage.service'
import { markPaymentMethodAdded } from '@/app/api/_services/getting-started.service'
import { CANCEL_COMEBACKS, cancelReasonTextSchema, type CancelReason, type RetentionOfferKind } from '@/ee/lib/billing/cancel-flow'
import { readCancelReason } from '@/ee/lib/billing/read-cancel-reason'
import type { CreditUsage } from '@/ee/lib/billing/credit-usage'
import { BILLING_INTERVALS } from '@/ee/lib/billing/plans'
import { MAX_CREDIT_PACKS_PER_PURCHASE } from '@rerun/contracts'
import { stripe } from '@/ee/lib/billing/stripe'
import type { TaxIdType } from '@/ee/lib/billing/tax-id'
import { z } from 'zod'
import { AppError, failure, failureOf, type ActionFailure, type ErrorCode } from '@/lib/i18n/action-error'

const sessionIdSchema = z.string().trim().min(1).max(200)

const requireBillingAdmin = () => requireAdminContext('adminOnlyBilling')

const creditPacksSchema = z.number().int().min(1).max(MAX_CREDIT_PACKS_PER_PURCHASE)

const planSelectionSchema = z.object({
    quantities: z.object({ linkedin_slot: z.number().int().min(0).max(1000), whatsapp_slot: z.number().int().min(0).max(1000) }),
    interval: z.enum(BILLING_INTERVALS),
})

// What an embedded checkout ended up doing to the workspace. The widget polls this beside the
// realtime workspace row: the row is faster when the webhook lands, this is the one that can say
// "the trial was refused" rather than leaving the widget waiting forever.
export async function readCheckoutOutcomeAction(sessionId: string): Promise<{ ok: true; outcome: CheckoutOutcome } | ActionFailure> {
    try {
        const outcome = await readCheckoutOutcome(z.string().trim().min(1).max(200).parse(sessionId))
        return { ok: true, outcome }
    } catch (err) {
        return failureOf(err, 'readCheckoutFailed')
    }
}

// The trial the cardless arm of the trial test starts from the offer card, without a card. `entitled:
// false` is not an error: the workspace simply goes through the card checkout instead.
export async function startTrialAction(): Promise<{ ok: true; entitled: boolean } | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, entitled: await startCardlessTrial() }
    } catch (err) {
        return failureOf(err, 'startTrialFailed')
    }
}

// What follows a completed setup session: the card is attached to the subscription, and a pay-now
// session converts the trial on the spot, while a card-only one leaves the trial running. The
// session id comes from the client, so the session must prove it belongs to the caller.
export async function confirmCardSetupAction(sessionId: string): Promise<{ ok: true } | ActionFailure> {
    try {
        const { workspace } = await requireBillingAdmin()
        const workspaceId = workspace.id
        const session = await stripe.checkout.sessions.retrieve(z.string().trim().min(1).max(200).parse(sessionId))
        if (session.metadata?.kind !== PLAN_CARD_SETUP_KIND) throw new AppError('notCardSetupSession')
        if (session.metadata?.workspace_id !== String(workspaceId)) throw new AppError('sessionOtherWorkspace')
        if (session.status !== 'complete') throw new AppError('cardFormIncomplete')
        await completeCardSetupSession(session)
        await markPaymentMethodAdded(workspaceId)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'saveCardFailed')
    }
}






// Live subscription state for the billing dialog: paid add-on quantities plus any
// downgrade pending until the next renewal. null when the workspace has no plan
// subscription yet.
export async function getSubscriptionStateAction(): Promise<{ ok: true; state: SubscriptionState | null } | ActionFailure> {
    try {
        return { ok: true, state: await getSubscriptionState() }
    } catch (err) {
        return failureOf(err, 'loadSubscriptionFailedShort')
    }
}

// What the cancel dialog quotes: dates, the share of the month already paid, and the retention
// offer if this workspace can still have it.
export async function getCancelFlowStateAction(): Promise<{ ok: true; state: CancelFlowState } | ActionFailure> {
    try {
        return { ok: true, state: await getCancelFlowState() }
    } catch (err) {
        return failureOf(err, 'loadSubscriptionFailed')
    }
}

// The agents and their runs, read off the workspace's engine. Best effort: null when the machine
// does not answer, and the dialog simply leaves those figures out.
export async function getCancelFlowActivityAction(): Promise<{ ok: true; activity: CancelFlowActivity | null } | ActionFailure> {
    try {
        return { ok: true, activity: await loadCancelFlowActivity(await requireWorkspaceId()) }
    } catch (err) {
        return failureOf(err, 'loadCoworkersFailed')
    }
}

// Whether what the customer wrote reads as a reason, and which one. A model that does not answer
// lets them through: the dialog counts the refusals and stops refusing, this never holds anyone.
export async function checkCancelReasonAction(text: string): Promise<{ ok: true; genuine: boolean; reason: CancelReason } | ActionFailure> {
    try {
        await requireBillingAdmin()
        const reading = await readCancelReason(cancelReasonTextSchema.parse(text))
        return { ok: true, genuine: reading?.genuine ?? true, reason: reading?.reason ?? 'other' }
    } catch (err) {
        return failureOf(err, 'readAnswerFailed')
    }
}

const cancelInputSchema = z.object({
    comeback: z.enum(CANCEL_COMEBACKS),
    comment: cancelReasonTextSchema,
})

// The text is read again here rather than trusting the dialog with its own verdict, and whatever
// the reading says the cancellation goes through: it only decides how the answer is filed.
export async function cancelSubscriptionAction(input: z.input<typeof cancelInputSchema>): Promise<{ ok: true } | ActionFailure> {
    try {
        await requireBillingAdmin()
        const parsed = cancelInputSchema.parse(input)
        const reading = await readCancelReason(parsed.comment)
        await cancelSubscription({ ...parsed, reason: reading?.reason ?? 'other', check: reading ? (reading.genuine ? 'genuine' : 'rejected') : 'unchecked' })
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'cancelSubscriptionFailed')
    }
}

export async function resumeSubscriptionAction(): Promise<{ ok: true } | ActionFailure> {
    try {
        await requireBillingAdmin()
        await resumeSubscription()
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'resumeSubscriptionFailed')
    }
}

export async function claimRetentionOfferAction(): Promise<{ ok: true; offer: RetentionOfferKind } | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, offer: await claimRetentionOffer() }
    } catch (err) {
        return failureOf(err, 'applyOfferFailed')
    }
}

export async function requestRenewalReminderAction(): Promise<{ ok: true; reminderAt: string } | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, reminderAt: await requestRenewalReminder() }
    } catch (err) {
        return failureOf(err, 'setReminderFailed')
    }
}

// --- The plan dialogs ---

// The plan Checkout rendered by the dialog itself. On a card trial the server sells the base plan
// monthly whatever the selection says, and `trial` tells the dialog so.
export async function createPlanCheckoutAction(selection: PlanSelection): Promise<({ ok: true } & PlanCheckoutSession) | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, ...(await createPlanCheckoutSession(planSelectionSchema.parse(selection))) }
    } catch (err) {
        return failureOf(err, 'startCheckoutFailed')
    }
}

// Called through the Checkout client's `runServerUpdate`, which reloads the session afterwards.
export async function updatePlanCheckoutAction(sessionId: string, selection: PlanSelection): Promise<{ ok: true } | ActionFailure> {
    try {
        await requireBillingAdmin()
        await updatePlanCheckoutSession(sessionIdSchema.parse(sessionId), planSelectionSchema.parse(selection))
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'updatePlanFailed')
    }
}

export async function acceptPlanTermsAction(sessionId: string): Promise<{ ok: true } | ActionFailure> {
    try {
        await requireBillingAdmin()
        await acceptPlanTerms(sessionIdSchema.parse(sessionId))
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'recordAcceptanceFailed')
    }
}

// The card form of the plan dialogs: the card goes on file, or settles a failed payment. Completed
// through confirmCardSetupAction; a trial paying today then runs the plan change from the dialog.
export async function createPlanCardSetupAction(): Promise<{ ok: true; clientSecret: string; sessionId: string } | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, ...(await createPlanCardSetupSession()) }
    } catch (err) {
        return failureOf(err, 'openCardFormFailed')
    }
}

export async function previewPlanChangeAction(selection: PlanSelection): Promise<{ ok: true; quote: PlanQuote | null } | ActionFailure> {
    try {
        return { ok: true, quote: await previewPlanChange(planSelectionSchema.parse(selection)) }
    } catch (err) {
        return failureOf(err, 'previewPlanChangeFailed')
    }
}

export async function changePlanAction(selection: PlanSelection): Promise<({ ok: true } & PlanChangeResult) | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, ...(await changePlan(planSelectionSchema.parse(selection))) }
    } catch (err) {
        return planChargeFailure(err)
    }
}

// The service already words a declined charge for the customer. Stripe's own wording is for
// developers except on a card error, so anything else Stripe throws reaches the customer as one
// readable line and the log keeps the rest.
function planChargeFailure(err: unknown, fallback: ErrorCode = 'changePlanFailed'): ActionFailure {
    const stripeError = err as { type?: string; code?: string; message?: string } | null
    if (!stripeError?.type?.startsWith('Stripe')) return failureOf(err, fallback)
    if (stripeError.type === 'StripeCardError' && !stripeError.code?.startsWith('subscription_') && stripeError.message) return { ok: false, error: stripeError.message }
    console.error('[billing] plan change refused by Stripe', err)
    return failure('chargeRefused')
}

// --- Rerun credit bought once ---

export async function quoteCreditPurchaseAction(packs: number): Promise<({ ok: true } & CreditQuote) | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, ...(await quoteCreditPurchase(creditPacksSchema.parse(packs))) }
    } catch (err) {
        return failureOf(err, 'quoteCreditFailed')
    }
}

export async function buyCreditAction(packs: number): Promise<({ ok: true } & CreditPurchaseResult) | ActionFailure> {
    try {
        await requireBillingAdmin()
        return { ok: true, ...(await buyCredit(creditPacksSchema.parse(packs))) }
    } catch (err) {
        return planChargeFailure(err, 'buyCreditFailed')
    }
}

export async function cancelPendingSwitchAction(): Promise<{ ok: true } | ActionFailure> {
    try {
        await requireBillingAdmin()
        await cancelPendingSwitch()
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'keepYearlyPlanFailed')
    }
}

// Where the workspace's Rerun credit went this period, for the billing dialog.
export async function getCreditUsageAction(): Promise<{ ok: true; usage: CreditUsage } | ActionFailure> {
    try {
        const ctx = await requireWorkspaceContext()
        return { ok: true, usage: await getCreditUsage(ctx.supabase, actorFromContext(ctx)) }
    } catch (err) {
        return failureOf(err, 'loadCreditUsageFailed')
    }
}

// An admin can pause the Rerun credit, and resume it: while it is paused the hub refuses every Rerun
// model and paid data call, so nothing is spent without someone turning it back on.
export async function setRerunCreditPausedAction(paused: boolean): Promise<{ ok: true } | ActionFailure> {
    try {
        const { workspace, supabase } = await requireBillingAdmin()
        const { error } = await supabase
            .from('workspaces')
            .update<Database['public']['Tables']['workspaces']['Update']>({ rerun_credit_paused_at: paused ? new Date().toISOString() : null })
            .eq('id', workspace.id)
        if (error) return { ok: false, error: error.message }
        return { ok: true }
    } catch (err) {
        return failureOf(err, paused ? 'pauseRerunCreditsFailed' : 'resumeRerunCreditsFailed')
    }
}

export async function listInvoicesAction(): Promise<{ ok: true; invoices: InvoiceSummary[] } | ActionFailure> {
    try {
        return { ok: true, invoices: await listInvoices() }
    } catch (err) {
        return failureOf(err, 'loadInvoicesFailed')
    }
}

// The type is only shaped here: the service checks it against the billing country.
const businessDetailsSchema = z.object({
    name: z.string().trim().min(1, 'businessNameRequired').max(256),
    type: z.string().regex(/^[a-z]{2}_[a-z_]+$/),
    value: z.string().trim().min(1, 'taxNumberRequired').max(64),
})

function businessDetailsRefusal(message: string | undefined): ActionFailure {
    if (message === 'businessNameRequired' || message === 'taxNumberRequired') return failure(message)
    return message ? { ok: false, error: message } : failure('invalidBusinessDetails')
}

export async function saveBusinessDetailsAction(input: z.input<typeof businessDetailsSchema>): Promise<{ ok: true; business: BusinessDetails } | ActionFailure> {
    try {
        await requireBillingAdmin()
        const parsed = businessDetailsSchema.safeParse(input)
        if (!parsed.success) return businessDetailsRefusal(parsed.error.issues[0]?.message)
        return { ok: true, business: await saveBusinessDetails({ ...parsed.data, type: parsed.data.type as TaxIdType }) }
    } catch (err) {
        return failureOf(err, 'saveBusinessDetailsFailed')
    }
}

export async function removeTaxIdAction(): Promise<{ ok: true } | ActionFailure> {
    try {
        await requireBillingAdmin()
        await removeTaxId()
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'removeNumberFailed')
    }
}
