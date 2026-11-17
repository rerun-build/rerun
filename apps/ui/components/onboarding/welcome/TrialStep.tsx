'use client'

import { useTranslations } from 'next-intl'
import { StepFrame } from './StepFrame'

// The trial, through today's checkout: the billing dialog takes the onboarding dialog's place on
// arrival, and the flow moves on the moment the workspace turns entitled (the session follows the row
// in realtime). Closed without a card, it leaves this screen with a button to open it again: nothing
// past it can run without a plan. A card already used for a trial is turned to the paid plan by the
// billing dialog itself, as everywhere else.
export function TrialStep({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
    const t = useTranslations('onboarding.trial')
    return <StepFrame title={t('title')} description={t('description')} onBack={onBack} primary={{ label: t('start'), onClick: onStart }} />
}
