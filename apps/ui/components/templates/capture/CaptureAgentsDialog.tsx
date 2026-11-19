'use client'

import { useStepper } from '@moldwright/ui/steps'
import { useLayoutEffect } from 'react'
import { useTranslations } from 'next-intl'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { StepDialogHeader } from '@/components/dialogs/StepDialogHeader'
import { Dialog } from '@/components/ui/dialog'
import { CaptureProgressPanel } from './CaptureProgressPanel'
import { useCaptureStepCopy } from './CaptureStepBody'
import { CaptureStepPanel } from './CaptureStepPanel'
import type { CaptureActions } from './types'
import { useCaptureFlow, type CaptureStep } from './useCaptureFlow'

type Stepper = ReturnType<typeof useStepper>

const STEPS: CaptureStep[] = ['select', 'review', 'done']

type CaptureAgentsDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    actions: CaptureActions
    onCaptured: () => void
}

export function CaptureAgentsDialog({ open, onOpenChange, actions, onCaptured }: CaptureAgentsDialogProps) {
    const stepper = useStepper(STEPS.length)
    const { reset } = stepper
    useLayoutEffect(() => {
        if (open) reset()
    }, [open, reset])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <SplitDialogContent aside={<CaptureProgressPanel step={STEPS[stepper.index]} />}>
                {open && <CaptureFlow stepper={stepper} actions={actions} onCaptured={onCaptured} onClose={() => onOpenChange(false)} />}
            </SplitDialogContent>
        </Dialog>
    )
}

function CaptureFlow({ stepper, actions, onCaptured, onClose }: { stepper: Stepper; actions: CaptureActions; onCaptured: () => void; onClose: () => void }) {
    const t = useTranslations('templates.capture.dialog')
    const { goTo } = stepper
    const flow = useCaptureFlow(actions)

    const step = STEPS[stepper.index]
    const copy = useCaptureStepCopy()[step]

    return (
        <div className="flex min-h-0 flex-col p-6">
            <StepDialogHeader count={STEPS.length} index={stepper.index} direction={stepper.direction} title={copy.title} description={copy.description} />

            <CaptureStepPanel
                flow={flow}
                step={step}
                direction={stepper.direction}
                onStepChange={next => {
                    if (next === 'done') onCaptured()
                    goTo(STEPS.indexOf(next))
                }}
                onClose={onClose}
                cancelLabel={t('cancel')}
                doneLabel={t('done')}
            />
        </div>
    )
}
