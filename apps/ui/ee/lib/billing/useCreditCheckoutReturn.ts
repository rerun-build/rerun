'use client'

import { CREDITS_PER_PACK } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { confirmCreditCheckoutAction } from '@/ee/actions/billing.actions'
import { useErrorText } from '@/hooks/useErrorText'
import { clearSearchParams } from '@/lib/clear-search-params'
import { useSession } from '@/supabase/session/SessionProvider'

// Back from the Stripe Checkout page of a credit purchase: the session is confirmed here instead of
// being left to the webhook, so the balance is up to date and the purchase is acknowledged when the
// board shows.
export function useCreditCheckoutReturn() {
    const t = useTranslations('billing.plan.credit')
    const errorText = useErrorText()
    const searchParams = useSearchParams()
    const { workspace, refreshWorkspace } = useSession()
    const started = useRef(false)

    useEffect(() => {
        const sessionId = searchParams.get('session_id')
        if (searchParams.get('credit') !== 'success' || !sessionId || !workspace || started.current) return
        started.current = true
        clearSearchParams('credit', 'session_id')
        void (async () => {
            const result = await confirmCreditCheckoutAction(sessionId)
            if (!result.ok) return void toast.error(errorText(result))
            await refreshWorkspace()
            toast.success(t('addedTitle'), { description: t('addedBody', { count: result.packs * CREDITS_PER_PACK }) })
        })()
    }, [searchParams, workspace, refreshWorkspace, t, errorText])
}
