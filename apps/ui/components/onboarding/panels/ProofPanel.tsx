'use client'

import { TESTIMONIALS, USER_COUNT } from '@rerun/cloud/testimonials'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { ProofQuote } from '../ProofQuote'
import { PanelPage } from './PanelPage'

// Beside the trial: the customers who started the same way, one at a time.
export function ProofPanel() {
    const t = useTranslations('onboarding.trial.proof')
    const locale = useLocale()
    if (TESTIMONIALS.length === 0) return null
    return (
        <PanelPage title={t('title', { count: formatNumber(USER_COUNT, locale) })} line={t('line')}>
            <div className="flex h-full flex-col justify-center">
                <div className="mx-auto w-full max-w-xl">
                    <ProofQuote large />
                </div>
            </div>
        </PanelPage>
    )
}
