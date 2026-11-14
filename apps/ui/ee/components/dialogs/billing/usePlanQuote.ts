'use client'

import { useEffect, useState } from 'react'

import { previewPlanChangeAction } from '@/ee/actions/billing.actions'
import type { PlanQuote, PlanSelection } from '@/ee/services/billing.service'

const QUOTE_DEBOUNCE_MS = 250

export function usePlanQuote(selection: PlanSelection, enabled: boolean): PlanQuote | null | 'loading' {
    const key = JSON.stringify(selection)
    const [answer, setAnswer] = useState<{ key: string; quote: PlanQuote | null } | null>(null)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        const timer = setTimeout(async () => {
            const result = await previewPlanChangeAction(JSON.parse(key) as PlanSelection)
            if (!cancelled) setAnswer({ key, quote: result.ok ? result.quote : null })
        }, QUOTE_DEBOUNCE_MS)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [key, enabled])

    if (!enabled) return null
    return answer?.key === key ? answer.quote : 'loading'
}
