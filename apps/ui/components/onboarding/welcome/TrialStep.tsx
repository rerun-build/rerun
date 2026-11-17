'use client'

import { useBillingStore } from '@/stores/billing.store'
import { track } from '@rerun/analytics/client'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { StepFrame } from './StepFrame'

// The trial, through today's checkout: the billing dialog opens over the page on its own, and the
// page moves on the moment the workspace turns entitled (the session follows the row in realtime).
// Closed without a card, the dialog leaves this screen with a button to open it again: nothing past
// it can run without a plan. A card already used for a trial is turned to the paid plan by the
// dialog itself, as everywhere else.
export function TrialStep({ onBack }: { onBack: () => void }) {
    const t = useTranslations('onboarding.trial')
    const openBilling = useBillingStore(state => state.openBilling)
    const billingOpen = useBillingStore(state => state.open)

    const openCheckout = () => {
        track('checkout_started', { plan: 'base', source: 'onboarding' })
        openBilling(undefined, 'onboarding')
    }

    const opened = useRef(false)
    useEffect(() => {
        if (opened.current) return
        opened.current = true
        openCheckout()
        // Once, on arrival: a dialog they closed stays closed until they ask for it again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return <StepFrame title={t('title')} description={t('description')} onBack={onBack} primary={{ label: t('start'), onClick: openCheckout, loading: billingOpen }} />
}
