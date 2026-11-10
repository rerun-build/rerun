'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getCreatorAccountAction, openCreatorDashboardAction, startCreatorOnboardingAction } from '@/ee/actions/creator-billing.actions'
import type { CreatorAccountState } from '@/ee/services/connect.service'

// `account === null` means loading, the same convention useMyTemplates uses. Reloaded on mount even
// when the user is coming back from Stripe: `account.updated` may still be in flight, and the panel
// must not show a stale "not set up" to someone who just finished onboarding.
export function useCreatorPayouts(active: boolean) {
    const [account, setAccount] = useState<CreatorAccountState | null>(null)
    const errorText = useErrorText()
    const [pending, setPending] = useState<'onboarding' | 'dashboard' | null>(null)

    const reload = useCallback(
        () =>
            getCreatorAccountAction().then(result => {
                if (!result.ok) {
                    toast.error(errorText(result))
                    return
                }
                setAccount(result.account)
            }),
        [errorText],
    )

    useEffect(() => {
        if (active) void reload()
    }, [active, reload])

    // Account links are single-use and expire in minutes, so one is minted per click and the user
    // leaves the app immediately.
    const startOnboarding = useCallback(async () => {
        setPending('onboarding')
        const result = await startCreatorOnboardingAction()
        if (!result.ok) {
            setPending(null)
            toast.error(errorText(result))
            return
        }
        window.location.href = result.url
    }, [errorText])

    const openDashboard = useCallback(async () => {
        setPending('dashboard')
        const result = await openCreatorDashboardAction()
        setPending(null)
        if (!result.ok) {
            toast.error(errorText(result))
            return
        }
        window.open(result.url, '_blank', 'noopener,noreferrer')
    }, [errorText])

    return { account, pending, reload, startOnboarding, openDashboard }
}
