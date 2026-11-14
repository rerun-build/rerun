'use client'

import { useTranslations } from 'next-intl'
import { ScrollFade } from '@rerun/ui/primitives'
import { StepTransition } from '@rerun/ui/steps'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { CaptureStepBody } from './CaptureStepBody'
import type { CaptureFlow, CaptureStep } from './useCaptureFlow'

type CaptureStepPanelProps = {
    flow: CaptureFlow
    step: CaptureStep
    direction: number
    onStepChange: (step: CaptureStep) => void
    onClose: () => void
    // Left out when the step has no explicit way back: the dialog close button is then the only exit.
    cancelLabel?: string
    doneLabel: string
}

// The left column of every capture wizard: the step body, then the footer. Only the two exit labels
// differ between capturing into a fresh draft and capturing into a template that already exists, so
// they are props rather than a second copy of this file.
export function CaptureStepPanel({ flow, step, direction, onStepChange, onClose, cancelLabel, doneLabel }: CaptureStepPanelProps) {
    const t = useTranslations('templates.capture.panel')
    const selectedCount = flow.selectedIds.length

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ScrollFade className="-mx-1 -mt-1 min-h-0 flex-1 px-1 pb-6 pt-1">
                <StepTransition stepKey={step} direction={direction}>
                    <CaptureStepBody step={step} flow={flow} />
                </StepTransition>

                {flow.error && <p className="mt-4 text-sm text-destructive">{flow.error}</p>}
            </ScrollFade>

            <DialogFooter className="mt-auto">
                {step === 'select' && (
                    <>
                        {cancelLabel && (
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {cancelLabel}
                            </Button>
                        )}
                        <Button
                            type="button"
                            disabled={selectedCount === 0}
                            loading={flow.busy}
                            onClick={async () => {
                                if (await flow.inspect()) onStepChange('review')
                            }}
                        >
                            {t('inspect', { count: selectedCount })}
                        </Button>
                    </>
                )}

                {step === 'review' && (
                    <>
                        {!flow.allApproved && (
                            <p className="text-xs text-amber-500 sm:mr-auto sm:self-center">
                                {t('reviewEach', { approved: flow.approvedCount, total: flow.plans.length })}
                            </p>
                        )}
                        <Button type="button" variant="ghost" onClick={() => onStepChange('select')}>
                            {t('back')}
                        </Button>
                        <Button
                            type="button"
                            disabled={!flow.allApproved}
                            loading={flow.busy}
                            onClick={async () => {
                                if (await flow.capture()) onStepChange('done')
                            }}
                        >
                            {t('capture')}
                        </Button>
                    </>
                )}

                {step === 'done' && (
                    <Button type="button" onClick={onClose}>
                        {doneLabel}
                    </Button>
                )}
            </DialogFooter>
        </div>
    )
}
