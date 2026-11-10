'use client'

import { useTranslations } from 'next-intl'
import { CaptureReviewStep } from './CaptureReviewStep'
import { CaptureSelectStep } from './CaptureSelectStep'
import type { CaptureFlow, CaptureStep } from './useCaptureFlow'

// Titles and bodies live together so the two shells that mount this flow cannot describe the same
// step differently.
export function useCaptureStepCopy(): Record<CaptureStep, { title: string; description: string }> {
    const t = useTranslations('templates.capture.steps')
    return {
        select: { title: t('select.title'), description: t('select.description') },
        review: { title: t('review.title'), description: t('review.description') },
        done: { title: t('done.title'), description: t('done.description') },
    }
}

export function CaptureStepBody({ step, flow }: { step: CaptureStep; flow: CaptureFlow }) {
    const t = useTranslations('templates.capture')
    if (step === 'select') {
        return (
            <CaptureSelectStep
                spaces={flow.spaces}
                spaceId={flow.spaceId}
                loading={flow.loadingSpaces}
                failed={flow.error !== null}
                onSpaceChange={flow.setSpaceId}
                selectedIds={flow.selectedIds}
                onToggle={flow.toggleAgent}
                onSelectionChange={flow.setSelection}
            />
        )
    }

    if (step === 'review') {
        return (
            <CaptureReviewStep
                plans={flow.plans}
                excluded={flow.excluded}
                approved={flow.approved}
                approvedCount={flow.approvedCount}
                setups={flow.setups}
                onToggleFiles={flow.toggleFiles}
                onApprove={flow.setApproval}
                onSetupChange={flow.setSetup}
            />
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-sm">{t('done', { count: flow.plans.length })}</p>
            {flow.warnings.map(warning => (
                <p key={warning} className="text-xs text-amber-500">
                    {warning}
                </p>
            ))}
        </div>
    )
}
