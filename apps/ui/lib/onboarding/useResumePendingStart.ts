'use client'

import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { useStartPending } from '@/lib/onboarding/useStartPending'
import { useBillingStore } from '@/stores/billing.store'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useCallback } from 'react'

// Replays whatever is parked (a first-agent draft or a shared template). Where it lands depends on
// the workspace: an already-entitled one (active/trialing) starts straight away; a not-yet-entitled
// one (fresh, expired or canceled) opens the paywall, and the work happens on the checkout return.
export function useResumePendingStart() {
    const { workspace } = useSession()
    const startPending = useStartPending()
    const openBilling = useBillingStore(s => s.openBilling)

    return useCallback(async () => {
        if (!workspace) return
        if (!hasPendingStart(useOnboardingStore.getState())) return

        if (isSubscriptionEntitled(workspace.subscription_status)) {
            await startPending()
            return
        }
        openBilling(undefined, 'resume_first_agent')
    }, [workspace, startPending, openBilling])
}
