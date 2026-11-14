import { track } from '@rerun/analytics/client'
import { toast } from 'sonner'
import { refusalText, translated } from '@/lib/i18n/toast-text'
import { startTrialAction } from '@/ee/actions/billing.actions'
import { BASE_PLAN_SLUG } from '@/ee/lib/billing/plans'
import { useBillingStore } from '@/stores/billing.store'

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
