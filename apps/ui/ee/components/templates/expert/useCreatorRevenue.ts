'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getCreatorRevenueAction } from '@/ee/actions/creator-billing.actions'
import type { CreatorRevenue, RevenueRange } from '@/ee/services/creator-revenue.service'

// `revenue === null` means loading, like every other panel here. The range is part of the fetch
// rather than a client-side filter: "all time" on a busy creator is more rows than a dialog needs.
export function useCreatorRevenue(active: boolean) {
    const [range, setRange] = useState<RevenueRange>('30d')
    const errorText = useErrorText()
    const [revenue, setRevenue] = useState<CreatorRevenue | null>(null)

    const load = useCallback(
        (next: RevenueRange) =>
            getCreatorRevenueAction(next).then(result => {
                if (!result.ok) {
                    toast.error(errorText(result))
                    return
                }
                setRevenue(result.revenue)
            }),
        [errorText],
    )

    useEffect(() => {
        if (active) void load(range)
    }, [active, range, load])

    const changeRange = useCallback((next: RevenueRange) => {
        setRevenue(null)
        setRange(next)
    }, [])

    return { revenue, range, changeRange }
}
