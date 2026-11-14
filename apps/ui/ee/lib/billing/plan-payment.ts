import { changePlanAction } from '@/ee/actions/billing.actions'
import type { PlanSelection } from '@/ee/services/billing.service'
import { stripeBrowser } from '@/ee/lib/billing/stripe-client'

const NOT_CONFIRMED = "Your bank didn't confirm the payment. Nothing was charged, try again."

async function confirmPlanPayment(clientSecret: string): Promise<void> {
    const stripe = await stripeBrowser()
    if (!stripe) throw new Error(NOT_CONFIRMED)
    const { error, paymentIntent } = await stripe.handleNextAction({ clientSecret })
    if (error) throw new Error(error.message ?? NOT_CONFIRMED)
    if (paymentIntent?.status !== 'succeeded' && paymentIntent?.status !== 'processing') throw new Error(NOT_CONFIRMED)
}

export async function runPlanChange(selection: PlanSelection): ReturnType<typeof changePlanAction> {
    const result = await changePlanAction(selection)
    if (!result.ok || !result.paymentClientSecret) return result
    try {
        await confirmPlanPayment(result.paymentClientSecret)
        return result
    } catch (err) {
        const message = err instanceof Error ? err.message : NOT_CONFIRMED
        return message === NOT_CONFIRMED ? { ok: false, error: NOT_CONFIRMED, code: 'bankNotConfirmed' } : { ok: false, error: message }
    }
}
