'use client'

import { track } from '@rerun/analytics/client'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { ARCHIVE_RETENTION_DAYS } from '@/lib/archive/retention'

import type { CancelFlowHeader } from '../../cancel-subscription/CancelFlow'
import { CancelFlowLoader } from '../../cancel-subscription/CancelSubscriptionDialog'
import type { CancelStep } from '../../cancel-subscription/cancel-flow-copy'
import type { CancelFlowState } from '@/ee/services/billing.service'
import { billingDate, Panel } from './bits'
import type { PanelProps } from './views'

// The first page of a cancellation: what happens next. Going on leads to the real flow, the reason
// and the retention offer, as pages of the same dialog.
export function CancelPanel({ state, data, go, onBack }: PanelProps) {
    const t = useTranslations('billing.tiles.cancel')
    const locale = useLocale()
    const trial = state.status === 'trialing'
    const ends = state.periodEnd ? billingDate(state.periodEnd, locale) : t('periodEnd')
    const trialDays = data.trialDaysLeft ?? 0
    const points = trial
        ? [t('trial.nothingCharged'), t('trial.keepRunning', { count: trialDays }), t('trial.saved', { days: ARCHIVE_RETENTION_DAYS })]
        : [t('paid.keepRunning', { date: ends }), t('paid.pauses'), t('paid.saved', { days: ARCHIVE_RETENTION_DAYS }), t('paid.restart')]

    return (
        <Panel>
            <ul className="flex flex-col gap-3">
                {points.map(point => (
                    <li key={point} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                        {point}
                    </li>
                ))}
            </ul>
            <div className="mt-auto flex flex-col gap-2 pt-6 sm:flex-row-reverse">
                <Button size="lg" className="h-11 flex-1 text-base" onClick={onBack}>
                    {t('keep')}
                </Button>
                <Button size="lg" variant="destructive" className="h-11 flex-1 text-base" onClick={() => go('cancelFlow')}>
                    {trial ? t('cancelTrial') : t('cancelPlan')}
                </Button>
            </div>
        </Panel>
    )
}

// The reason, the retention offer, the farewell and the outcome, each a page of the billing dialog.
export function CancelFlowPanel({ onHeader, onLeave, onChanged }: { onHeader: (header: CancelFlowHeader) => void; onLeave: (to: 'cancel' | 'home') => void; onChanged: () => void }) {
    const reached = useRef<{ phase: CancelFlowState['phase']; step: CancelStep } | null>(null)

    useEffect(
        () => () => {
            if (reached.current && reached.current.step !== 'done') track('cancel_flow_abandoned', reached.current)
        },
        [],
    )

    return (
        <CancelFlowLoader
            embedded={{ firstStep: 'reason', onHeader }}
            onChanged={onChanged}
            onFailed={() => onLeave('cancel')}
            onClose={() => onLeave(reached.current?.step === 'reason' ? 'cancel' : 'home')}
            onStepChange={step => (reached.current = step)}
        />
    )
}
