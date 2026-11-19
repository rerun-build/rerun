'use client'

import { useEffect, useState } from 'react'

import { getReferralOverviewAction } from '@/ee/actions/referral.actions'
import type { ReferralOverview } from '@/ee/lib/billing/referral'

// Read once when the plan dialog opens: the overview row and the Refer a friend pane share it.
// `failed` lets the pane say so instead of drawing its skeleton forever.
export function useReferrals(): { overview: ReferralOverview | null; failed: boolean } {
    const [overview, setOverview] = useState<ReferralOverview | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        getReferralOverviewAction().then(result => {
            if (cancelled) return
            if (result.ok) setOverview(result.overview)
            else setFailed(true)
        })
        return () => {
            cancelled = true
        }
    }, [])

    return { overview, failed }
}
