'use client'

import { useStepper } from '@rerun/ui/steps'
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

// Capturing into a template that already exists. Same frame and same panel as the create wizard,
// minus its title step: only the labels of the two exits change. The progress panel still lists the
// naming stage, which reads as done here because the template is already named.
//
// The flow is mounted only while the dialog is open, so closing it is what resets the selection.
export function CaptureAgentsDialog({ open, onOpenChange, actions, onCaptured }: CaptureAgentsDialogProps) {
    // The stepper sits above the conditional mount, because the progress panel is passed as `aside`
    // and has to know the step too. Rewound before the reopened dialog paints, or the panel would
    // flash the step the previous run ended on.
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
    // Held here rather than inside the panel: StepTransition keys its subtree on the step, so a hook
    // mounted in there would lose its plans on the way to the review.
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
