'use client'

import { useStepper } from '@rerun/ui/steps'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { CreateTemplateTitleStep } from '@/components/dialogs/CreateTemplateTitleStep'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { LayoutGridIcon } from '@/lib/icons'
import { StepDialogHeader } from '@/components/dialogs/StepDialogHeader'
import { CaptureProgressPanel } from '@/components/templates/capture/CaptureProgressPanel'
import { useCaptureStepCopy } from '@/components/templates/capture/CaptureStepBody'
import { CaptureStepPanel } from '@/components/templates/capture/CaptureStepPanel'
import type { CaptureActions } from '@/components/templates/capture/types'
import { useCaptureFlow, type CaptureStep } from '@/components/templates/capture/useCaptureFlow'
import { Dialog } from '@/components/ui/dialog'

const STEPS = ['title', 'select', 'review', 'done'] as const

type Stepper = ReturnType<typeof useStepper>

type CreateTemplateDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreate: (title: string) => Promise<string | null>
    captureActions: (key: string) => CaptureActions
    onDone: (key: string) => void
    description?: string
}

// Creating and capturing are one dialog but two writes: the draft lands as soon as the title is in,
// because the slug it produces is what addresses both the row and the archives the capture uploads.
// Leaving after the title therefore keeps the draft, exactly as it did before the capture existed.
//
// The expert panel and the admin console mount the same wizard: what a template is addressed by (an
// id there, a slug here) only ever reaches this component through `captureActions`.
export function CreateTemplateDialog({ open, onOpenChange, onCreate, captureActions, onDone, description }: CreateTemplateDialogProps) {
    const t = useTranslations('dialogs.createTemplate')
    const [createdKey, setCreatedKey] = useState<string | null>(null)
    // Held here rather than in the flow because the progress panel is passed as `aside` and reads
    // the step too.
    const stepper = useStepper(STEPS.length)
    const { reset } = stepper

    const close = () => {
        const key = createdKey
        setCreatedKey(null)
        reset()
        onOpenChange(false)
        if (key) onDone(key)
    }

    const step = STEPS[stepper.index]

    return (
        <Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
            <SplitDialogContent aside={<CaptureProgressPanel step={step} />}>
                <CreateTemplateFlow
                    stepper={stepper}
                    createdKey={createdKey}
                    onCreated={setCreatedKey}
                    onCreate={onCreate}
                    captureActions={captureActions}
                    onClose={close}
                    description={description ?? t('defaultDescription')}
                />
            </SplitDialogContent>
        </Dialog>
    )
}

type CreateTemplateFlowProps = {
    stepper: Stepper
    createdKey: string | null
    onCreated: (key: string) => void
    onCreate: (title: string) => Promise<string | null>
    captureActions: (key: string) => CaptureActions
    onClose: () => void
    description: string
}

function CreateTemplateFlow({ stepper, createdKey, onCreated, onCreate, captureActions, onClose, description }: CreateTemplateFlowProps) {
    const t = useTranslations('dialogs.createTemplate')
    const captureCopy = useCaptureStepCopy()
    const { goTo } = stepper

    // The flow is held here rather than inside the capture panel, because StepTransition keys its
    // subtree on the step: a hook mounted in there would lose its plans on the way to the review.
    // Listing the spaces needs no template, so it warms up while the title is being typed; plan and
    // capture are only reachable once the draft exists.
    const actions = useMemo(() => captureActions(createdKey ?? ''), [captureActions, createdKey])
    const flow = useCaptureFlow(actions)

    const step = STEPS[stepper.index]
    const copy = step === 'title' ? { title: t('title'), description } : captureCopy[step]

    return (
        <div className="flex min-h-0 flex-col">
            <StepDialogHeader icon={LayoutGridIcon} count={STEPS.length} index={stepper.index} direction={stepper.direction} title={copy.title} description={copy.description} />
            <div className="flex min-h-0 flex-1 flex-col p-4">
                {step === 'title' ? (
                    <CreateTemplateTitleStep
                        onCancel={onClose}
                        onCreate={async title => {
                            const key = await onCreate(title)
                            if (!key) return
                            onCreated(key)
                            goTo(1)
                        }}
                    />
                ) : (
                    <CaptureStepPanel
                        flow={flow}
                        step={step as CaptureStep}
                        direction={stepper.direction}
                        onStepChange={next => goTo(STEPS.indexOf(next))}
                        onClose={onClose}
                        doneLabel={t('doneLabel')}
                    />
                )}
            </div>
        </div>
    )
}
