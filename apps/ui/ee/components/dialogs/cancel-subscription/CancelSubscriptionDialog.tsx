'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { useErrorText, type Refusal } from '@/hooks/useErrorText'
import { cancelSubscriptionAction, checkCancelReasonAction, claimRetentionOfferAction, getCancelFlowActivityAction, getCancelFlowStateAction, requestRenewalReminderAction, resumeSubscriptionAction } from '@/ee/actions/billing.actions'
import type { CancelFlowState } from '@/ee/services/billing.service'
import type { CancelFlowActivity } from '@/ee/services/cancel-flow-activity.service'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useRerunCredit } from '@/hooks/useRerunCredit'
import { useBoardStore } from '@/stores/board.store'
import { track } from '@rerun/analytics/client'
import { formatCredits } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CancelFlow, type CancelInput } from './CancelFlow'
import type { CancelStep } from './cancel-flow-copy'

type CancelSubscriptionDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    // Called after anything that changed the subscription, so the billing dialog behind reloads it.
    onChanged: () => void
}

export function CancelSubscriptionDialog({ open, onOpenChange, onChanged }: CancelSubscriptionDialogProps) {
    const step = useRef<{ phase: CancelFlowState['phase']; step: CancelStep } | null>(null)

    const close = () => {
        if (step.current && step.current.step !== 'done') track('cancel_flow_abandoned', step.current)
        step.current = null
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
            <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[30rem]" onInteractOutside={event => event.preventDefault()}>
                <CancelFlowLoader onChanged={onChanged} onClose={close} onFailed={() => onOpenChange(false)} onStepChange={next => (step.current = next)} />
            </DialogContent>
        </Dialog>
    )
}

// Mounted with the dialog's content, so every opening starts from a fresh read of the subscription.
function CancelFlowLoader({
    onChanged,
    onClose,
    onFailed,
    onStepChange,
}: {
    onChanged: () => void
    onClose: () => void
    onFailed: () => void
    onStepChange: (step: { phase: CancelFlowState['phase']; step: CancelStep }) => void
}) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [state, setState] = useState<CancelFlowState | null>(null)
    const [activity, setActivity] = useState<CancelFlowActivity | null>(null)
    const [activityLoading, setActivityLoading] = useState(true)

    const agentCount = useBoardStore(s => s.agents.filter(agent => !agent.disabledAt).length)
    const credit = useRerunCredit()
    const creditLeftLabel = formatCredits(Math.max(0, credit.budgetMicros - credit.usedMicros), locale)

    const failed = useEffectEvent((error: string) => {
        toast.error(t('cancel.toasts.openFailed'), { description: error })
        onFailed()
    })

    useEffect(() => {
        let cancelled = false
        void getCancelFlowStateAction().then(res => {
            if (cancelled) return
            if (!res.ok) return failed(errorText(res))
            setState(res.state)
            track('cancel_flow_started', { phase: res.state.phase })
        })
        void getCancelFlowActivityAction().then(res => {
            if (cancelled) return
            setActivity(res.ok ? res.activity : null)
            setActivityLoading(false)
        })
        return () => {
            cancelled = true
        }
    }, [])

    const phase = state?.phase
    const handleStepChange = useCallback((next: CancelStep) => {
        if (phase) onStepChange({ phase, step: next })
    }, [phase, onStepChange])

    const settle = async (res: { ok: true } | ({ ok: false; error: string } & Refusal), failure: string): Promise<boolean> => {
        if (!res.ok) {
            toast.error(failure, { description: errorText(res) })
            return false
        }
        onChanged()
        return true
    }

    const onRemind = async () => {
        if (!state) return false
        if (state.phase === 'paid') {
            const res = await requestRenewalReminderAction()
            if (!res.ok) {
                toast.error(t('cancel.toasts.remindFailed'), { description: errorText(res) })
                return false
            }
        }
        track('renewal_reminder_requested', { phase: state.phase })
        return true
    }

    const onClaim = async () => settle(await claimRetentionOfferAction(), t('cancel.toasts.claimFailed'))
    const onCancel = async (input: CancelInput) => settle(await cancelSubscriptionAction(input), t('cancel.toasts.cancelFailed'))

    const onCheckReason = async (text: string) => {
        const res = await checkCancelReasonAction(text)
        return res.ok ? { genuine: res.genuine, reason: res.reason } : null
    }

    const onResume = async () => {
        const ok = await settle(await resumeSubscriptionAction(), t('cancel.toasts.resumeFailed'))
        if (ok) toast.success(state?.phase === 'trial' ? t('cancel.toasts.trialResumed') : t('cancel.toasts.subscriptionResumed'))
        return ok
    }

    if (!state) return <CancelFlowSkeleton />

    return (
        <CancelFlow
            state={state}
            activity={activity}
            activityLoading={activityLoading}
            agentCount={agentCount}
            creditLeftLabel={creditLeftLabel}
            onRemind={onRemind}
            onClaim={onClaim}
            onCancel={onCancel}
            onCheckReason={onCheckReason}
            onResume={onResume}
            onClose={onClose}
            onStepChange={handleStepChange}
        />
    )
}

function CancelFlowSkeleton() {
    const t = useTranslations('billing')
    return (
        <div className="flex min-h-0 flex-col">
            <DialogHeaderBar icon={<Skeleton className="size-10 rounded-lg" />} title={t('cancel.buttons.cancelSubscription')} />
            <div className="p-4">
                <div className="flex flex-col gap-5">
                    <Skeleton className="h-32 w-full rounded-xl" />
                    <Skeleton className="h-[4.75rem] w-full rounded-xl" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                </div>
            </div>
            <DialogFooter className="m-0 sm:justify-between">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-36" />
            </DialogFooter>
        </div>
    )
}
