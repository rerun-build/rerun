'use client'

import { useStepper } from '@rerun/ui/steps'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { CreateTemplateTitleStep } from '@/components/dialogs/CreateTemplateTitleStep'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
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

export function CreateTemplateDialog({ open, onOpenChange, onCreate, captureActions, onDone, description }: CreateTemplateDialogProps) {
    const t = useTranslations('dialogs.createTemplate')
    const [createdKey, setCreatedKey] = useState<string | null>(null)
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

    const actions = useMemo(() => captureActions(createdKey ?? ''), [captureActions, createdKey])
    const flow = useCaptureFlow(actions)

    const step = STEPS[stepper.index]
    const copy = step === 'title' ? { title: t('title'), description } : captureCopy[step]

    return (
        <div className="flex min-h-0 flex-col p-6">
            <StepDialogHeader count={STEPS.length} index={stepper.index} direction={stepper.direction} title={copy.title} description={copy.description} />

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
    )
}
