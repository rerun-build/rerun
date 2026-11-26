import type { ReferralOverview } from '@/ee/lib/billing/referral'
import type { InvoiceSummary, SubscriptionState } from '@/ee/services/billing.service'
import type { AppSlug } from '@/lib/apps/types'

import type { AppSlotsState } from '../AppsSection'
import type { CreditUsageState } from '../credit-usage/useCreditUsage'
import type { SummaryRow } from '../parts'

export type View = 'home' | 'plan' | 'credits' | 'usage' | 'apps' | 'payment' | 'card' | 'business' | 'invoices' | 'referral' | 'cancel' | 'cancelFlow'

export type Success = { title: string; body: string; rows?: SummaryRow[] }

// What the home and several pages read, loaded once when the dialog opens.
export type TilesData = {
    credit: CreditUsageState
    invoices: InvoiceSummary[] | null
    referrals: { overview: ReferralOverview | null; failed: boolean }
    apps: AppSlug[]
    appSlots: Partial<Record<AppSlug, AppSlotsState>>
    // The trial's end, read off the workspace, and the days left to it when the dialog opened: null
    // outside a trial.
    trialEndsAt: string | null
    trialDaysLeft: number | null
}

export type PanelProps = {
    state: SubscriptionState
    data: TilesData
    go: (view: View) => void
    onBack: () => void
    onDone: (success: Success) => void | Promise<void>
}
