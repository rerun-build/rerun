'use client'

import { PhoneVerificationStep } from '@rerun/cloud/phone.client'
import { useTranslations } from 'next-intl'
import { StepFrame } from './StepFrame'

// The number a Google or Apple sign-up still owes, asked before the questions as the phone wall
// asks it everywhere else. The step reads the account's own state, so it lets go on its own.
export function PhoneStep() {
    const t = useTranslations('dialogs.phoneVerification')
    return (
        <StepFrame title={t('title')} description={t('subtitle')}>
            <div className="space-y-4">
                <PhoneVerificationStep active />
            </div>
        </StepFrame>
    )
}
