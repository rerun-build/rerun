'use client'

import { useEffect, useState } from 'react'

import { getCreditUsageAction } from '@/ee/actions/billing.actions'
import { addOneMonth } from '@/ee/lib/billing/cancel-flow'
import { creditBalance, type CreditBalance, type CreditUsage } from '@/ee/lib/billing/credit-usage'
import { useSession } from '@/supabase/session/SessionProvider'

export type CreditUsageState = {
    balance: CreditBalance | null
    usage: CreditUsage | null
    loading: boolean
    trial: boolean
    resetsOn: Date | null
    paused: boolean
}

export function useCreditUsage({ enabled = true }: { enabled?: boolean } = {}): CreditUsageState {
    const { workspace } = useSession()
    const [usage, setUsage] = useState<CreditUsage | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        getCreditUsageAction().then(result => {
            if (cancelled) return
            if (result.ok) setUsage(result.usage)
            setLoading(false)
        })
        return () => {
            cancelled = true
        }
    }, [enabled])

    const columns = { budgetMicros: workspace?.rerun_budget_micros ?? 0, usedMicros: workspace?.rerun_used_micros ?? 0, topupMicros: workspace?.rerun_topup_micros ?? 0 }
    const anchor = workspace?.rerun_period_anchor
    return {
        balance: loading ? null : creditBalance(columns, usage),
        usage,
        loading,
        trial: workspace?.subscription_status === 'trialing',
        resetsOn: anchor ? addOneMonth(new Date(anchor)) : null,
        paused: !!workspace?.rerun_credit_paused_at,
    }
}
