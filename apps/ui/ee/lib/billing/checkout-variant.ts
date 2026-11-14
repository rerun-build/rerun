import { isSubscriptionEntitled } from './entitlement'
import { trialArm } from './trial-experiment'

export type CheckoutVariant = 'start_trial' | 'trial_cardless' | 'trial_card' | 'credit_locked' | 'no_plan' | 'complimentary' | 'paused' | 'template'

export type CheckoutPayment = 'subscribe' | 'card_form' | 'card_on_file'

export type TrialOffer = 'cardless' | 'card_trial' | 'paid'

export function trialOffer(workspace: { id: number; trial_ends_at: string | null; is_sandbox: boolean } | null | undefined): TrialOffer {
    if (workspace?.trial_ends_at || workspace?.is_sandbox) return 'paid'
    return workspace && trialArm(workspace.id) === 'cardless' ? 'cardless' : 'card_trial'
}

export type CheckoutRoute = { variant: CheckoutVariant; payment: CheckoutPayment }

export type CheckoutRouteInput = {
    status: string | null | undefined
    offer: TrialOffer
    paused: boolean
    hasPendingStart: boolean
    trigger: string | null
    hasStripePlan: boolean
    hasPaymentMethod: boolean
}

const CREDIT_TRIGGERS = new Set(['budget_exhausted', 'budget_exhausted_trial', 'ai_providers'])

export function checkoutRouteFor(input: CheckoutRouteInput): CheckoutRoute | null {
    if (input.status === 'trialing') {
        const payment = input.hasPaymentMethod ? 'card_on_file' : 'card_form'
        if (input.trigger && CREDIT_TRIGGERS.has(input.trigger)) return { variant: 'credit_locked', payment }
        return { variant: input.hasPaymentMethod ? 'trial_card' : 'trial_cardless', payment }
    }

    if (isSubscriptionEntitled(input.status)) return input.hasStripePlan ? null : { variant: 'complimentary', payment: 'subscribe' }

    if (input.paused) return { variant: 'paused', payment: 'subscribe' }
    if (input.offer !== 'paid') return { variant: 'start_trial', payment: 'subscribe' }
    return { variant: input.hasPendingStart ? 'template' : 'no_plan', payment: 'subscribe' }
}
