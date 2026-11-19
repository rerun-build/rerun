'use client'

import { track } from '@moldwright/analytics/client'
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
            if (complete) setOpen(true)
        },
    })

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
        if (step.id === 'phone') useAccountStore.getState().openAccount('sign-in', 'phone')
        else if (step.id === 'payment_method') useBillingStore.getState().openBilling(undefined, 'getting_started')
        else if (step.panel) useWorkspaceSettingsStore.getState().openWorkspacePanel(step.panel)
        else if (step.prompt) useForemanStore.getState().askForeman(t.has(step.id as never) ? t(step.id as never) : step.prompt)
    }

    return <GettingStartedPopover {...state} open={open} onOpenChange={setOpen} onStep={handleStep} onHide={dismiss} pulse={pulse} />
}
