'use client'

import { isSubscriptionEntitled } from '@moldwright/cloud/billing'
import { useStartPending } from '@/lib/onboarding/useStartPending'
import { useBillingStore } from '@/stores/billing.store'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { useCallback } from 'react'

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
