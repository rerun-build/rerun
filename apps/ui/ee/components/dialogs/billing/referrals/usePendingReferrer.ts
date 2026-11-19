'use client'

import { useEffect, useState } from 'react'

import { getPendingReferrerAction } from '@/ee/actions/referral.actions'
import type { Referrer } from '@/ee/services/referral-attach.service'

// Who invited this workspace, for the trial checkout to name. null until read, and when nobody did.
export function usePendingReferrer(enabled: boolean): Referrer | null {
    const [referrer, setReferrer] = useState<Referrer | null>(null)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        getPendingReferrerAction().then(result => {
            if (!cancelled && result.ok) setReferrer(result.referrer)
        })
        return () => {
            cancelled = true
        }
    }, [enabled])

    return referrer
}
