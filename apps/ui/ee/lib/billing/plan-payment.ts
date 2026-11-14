import { buyCreditAction, changePlanAction } from '@/ee/actions/billing.actions'
import type { PlanSelection } from '@/ee/services/billing.service'
import { stripeBrowser } from '@/ee/lib/billing/stripe-client'

const NOT_CONFIRMED = "Your bank didn't confirm the payment. Nothing was charged, try again."

// Opens the bank's 3-D Secure window over the dialog for a charge the server left waiting.
async function confirmPlanPayment(clientSecret: string): Promise<void> {
    const stripe = await stripeBrowser()
    if (!stripe) throw new Error(NOT_CONFIRMED)
    const { error, paymentIntent } = await stripe.handleNextAction({ clientSecret })
    if (error) throw new Error(error.message ?? NOT_CONFIRMED)
    if (paymentIntent?.status !== 'succeeded' && paymentIntent?.status !== 'processing') throw new Error(NOT_CONFIRMED)
}

// The plan change as every billing dialog runs it: the change, then the bank's confirmation when it
// asks for one. Until that confirmation succeeds Stripe keeps the change on hold, so a refusal here
// leaves the plan exactly as it was.
export async function runPlanChange(selection: PlanSelection): ReturnType<typeof changePlanAction> {
    const result = await changePlanAction(selection)
    if (!result.ok || !result.paymentClientSecret) return result
    try {
        await confirmPlanPayment(result.paymentClientSecret)
        return result
    } catch (err) {
        // Stripe's own refusal is already in the reader's language; ours goes by its code.
        const message = err instanceof Error ? err.message : NOT_CONFIRMED
        return message === NOT_CONFIRMED ? { ok: false, error: NOT_CONFIRMED, code: 'bankNotConfirmed' } : { ok: false, error: message }
    }
}

// A credit purchase as the dialog runs it: charged on the card on file, confirmed with the bank when
// it asks, or handed to a Stripe Checkout page when there is no card to charge. The credit is granted
// by the server once the payment succeeds, never by this page.
export async function runCreditPurchase(packs: number): ReturnType<typeof buyCreditAction> {
    const result = await buyCreditAction(packs)
    if (!result.ok || result.kind !== 'confirm') return result
    try {
        await confirmPlanPayment(result.clientSecret)
        return { ok: true, kind: 'paid' }
    } catch (err) {
        const message = err instanceof Error ? err.message : NOT_CONFIRMED
        return message === NOT_CONFIRMED ? { ok: false, error: NOT_CONFIRMED, code: 'bankNotConfirmed' } : { ok: false, error: message }
    }
}
