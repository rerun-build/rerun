'use client'

import { track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { GettingStartedPopover } from '@/components/foreman/getting-started/GettingStartedPopover'
import { useGettingStarted } from '@/hooks/useGettingStarted'
import type { GettingStartedStep } from '@/lib/onboarding/getting-started'
import { useAccountStore } from '@/stores/account.store'
import { useBillingStore } from '@/stores/billing.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useSession } from '@/supabase/session/SessionProvider'

/**
 * The checklist in the board's bottom-left corner. Steps without a settings panel are handed to the Foreman,
 * so it only shows once the Foreman on the engine has taken over: never over the onboarding funnel it
 * would talk over, and never for a workspace with no machine, which has no Foreman to hand them to.
 */
export function GettingStartedPill() {
    const t = useTranslations('foreman.gettingStarted.prompts')
    const { isAnonymous, workspace } = useSession()
    const companion = useForemanStore(state => state.funnel === 'companion' && state.surface === 'engine')
    const enabled = companion && !isAnonymous && !workspace?.is_sandbox

    const [open, setOpen] = useState(false)
    const [pulse, setPulse] = useState(0)
    const { state, dismiss, restore } = useGettingStarted({
        enabled,
        onLiveStep: ({ complete }) => {
            setPulse(value => value + 1)
            // The last tick opens the list once, on the celebration it earned.
            if (complete) setOpen(true)
        },
    })

    // The profile menu's "Getting started": opens the list, and brings it back first if it was hidden.
    const openRequest = useForemanStore(state => state.gettingStartedOpenRequest)
    const handledOpenRequest = useRef(openRequest)
    useEffect(() => {
        if (openRequest === handledOpenRequest.current) return
        handledOpenRequest.current = openRequest
        setOpen(true)
        void restore().catch(() => setOpen(false))
    }, [openRequest, restore])

    if (!enabled || !state) return null

    const handleStep = (step: GettingStartedStep) => {
        setOpen(false)
        track('getting_started_step_clicked', { step: step.id })
        // The billing dialog takes the card: beside a running trial it offers to pay at its end.
        if (step.id === 'phone') useAccountStore.getState().openAccount('sign-in', 'phone')
        else if (step.id === 'payment_method') useBillingStore.getState().openBilling(undefined, 'getting_started')
        else if (step.panel) useWorkspaceSettingsStore.getState().openWorkspacePanel(step.panel)
        else if (step.prompt) useForemanStore.getState().askForeman(t.has(step.id as never) ? t(step.id as never) : step.prompt)
    }

    return <GettingStartedPopover {...state} open={open} onOpenChange={setOpen} onStep={handleStep} onHide={dismiss} pulse={pulse} />
}
