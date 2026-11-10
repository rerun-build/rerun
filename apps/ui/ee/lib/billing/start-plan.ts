import { track } from '@rerun/analytics/client'
import { toast } from 'sonner'
import { refusalText, translated } from '@/lib/i18n/toast-text'
import { startTrialAction } from '@/ee/actions/billing.actions'
import { BASE_PLAN_SLUG } from '@/ee/lib/billing/plans'
import { useBillingStore } from '@/stores/billing.store'

// Every button outside the foreman that puts a workspace on the plan. The trial test decides the
// card here as it does in the foreman: the cardless arm starts the trial on the spot, and only what
// the server turns down (the card arm, a spent trial, a sandbox) goes on to the billing dialog, whose
// success panel lands whatever the caller parked.
//
// A trial started without a card mirrors the Checkout return (/?billing=success): whatever the
// caller parked before calling this is picked up by HomeContent's PostPaymentDialog, as it would be
// coming back from Stripe.
export async function startPlan(source: 'template_cta' | 'agent_share' | 'billing_dialog' | 'ai_providers'): Promise<void> {
    const trial = await startTrialAction()
    if (!trial.ok) {
        toast.error(translated('billing.startPlan.trialFailed'), { description: refusalText(trial) })
        return
    }
    if (trial.entitled) {
        toast.success(translated('billing.startPlan.trialStarted'))
        window.location.href = '/?billing=success'
        return
    }

    track('checkout_started', { plan: BASE_PLAN_SLUG, source })
    useBillingStore.getState().openBilling(undefined, source)
}
