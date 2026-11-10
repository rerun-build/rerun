'use client'

import { Button, Icon, ScrollFade } from '../primitives'
import { BorderBeam } from '../BorderBeam'
import { cn } from '../cn'
import { CheckIcon, ChevronLeft, ChevronRight, ShieldAlertIcon } from '../icons'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { useKitTranslations } from '../locale'
import type { ApprovalDecision, ApprovalItem } from '@rerun/contracts'
import { DeclineReasonForm } from './DeclineReasonForm'
import { StepDots } from './StepDots'

export type { ApprovalDecision, ApprovalItem }

export type ActionApprovalBlockProps = {
    approvals: ApprovalItem[]
    onSubmit: (decisions: ApprovalDecision[]) => void
    disabled?: boolean
    // Rendered in the conversation's own scroll rather than pinned above the composer: no dock margin.
    inline?: boolean
    className?: string
}

type DecisionValue = Pick<ApprovalDecision, 'decision' | 'note'>

export function ActionApprovalBlock({ approvals, onSubmit, disabled, inline, className }: ActionApprovalBlockProps) {
    const t = useKitTranslations()
    const [declining, setDeclining] = useState(false)
    const [note, setNote] = useState('')
    const [decisions, setDecisions] = useState<Record<number, DecisionValue>>({})
    const [submitted, setSubmitted] = useState(false)
    const [current, setCurrent] = useState(0)
    // The state above only drives the disabled styling. Answering the agent twice starts two runs
    // on the same conversation, so the latch that guards it has to be a ref: two callbacks fired
    // from the same render both read the same stale `submitted`.
    const submittedRef = useRef(false)

    const locked = disabled || submitted
    const approval = approvals[current]
    const currentDecision = decisions[current]

    const goTo = (index: number) => {
        if (locked || declining || index < 0 || index >= approvals.length) return
        setCurrent(index)
    }

    const decide = (decision: ApprovalDecision['decision'], reason?: string) => {
        if (disabled || submittedRef.current || !approval) return

        const nextDecisions = {
            ...decisions,
            [current]: { decision, note: decision === 'declined' ? reason : undefined },
        }
        setDecisions(nextDecisions)
        setDeclining(false)
        setNote('')

        const firstMissing = approvals.findIndex((_, index) => !nextDecisions[index])
        if (firstMissing === -1) {
            submittedRef.current = true
            setSubmitted(true)
            onSubmit(
                approvals.map((item, index) => ({
                    ...item,
                    ...nextDecisions[index],
                }))
            )
            return
        }

        const nextMissing = approvals.findIndex((_, index) => index > current && !nextDecisions[index])
        setCurrent(nextMissing === -1 ? firstMissing : nextMissing)
    }

    const startDeclining = () => {
        if (locked) return
        setNote(currentDecision?.decision === 'declined' ? (currentDecision.note ?? '') : '')
        setDeclining(true)
    }

    if (!approval) return null

    const progress =
        approvals.length <= 1 ? (
            <div />
        ) : approvals.length <= 6 ? (
            <StepDots count={approvals.length} current={current} answered={approvals.map((_, index) => !!decisions[index])} onSelect={goTo} disabled={locked || declining} />
        ) : (
            <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="ghost" disabled={locked || declining || current === 0} onClick={() => goTo(current - 1)} aria-label={t('chat.actionApproval.previous')} className="-my-1 text-muted-foreground">
                    <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
                    {current + 1} / {approvals.length}
                </span>
                <Button size="icon-sm" variant="ghost" disabled={locked || declining || current === approvals.length - 1} onClick={() => goTo(current + 1)} aria-label={t('chat.actionApproval.next')} className="-my-1 text-muted-foreground">
                    <ChevronRight className="size-4" />
                </Button>
            </div>
        )

    return (
        <div className={cn('relative space-y-2.5 overflow-hidden rounded-lg px-4 pt-3 pb-4', !inline && 'mb-2', className)}>
            <BorderBeam animated pattern="arcs" tone="orange" glow width={1} duration={7} />
            <div className="flex items-center gap-2.5 text-sm">
                <Icon size="sm" tone="orange" icon={ShieldAlertIcon} className="bg-orange-500/10 text-foreground" />
                <span className="font-medium text-foreground">{t('chat.actionApproval.title')}</span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={current} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-2.5">
                    <p className="text-sm text-foreground">{approval.action}</p>
                    {approval.detail && (
                        <ScrollFade className="max-h-[22vh] rounded bg-background">
                            <code className="block whitespace-pre-wrap break-all px-2 py-1.5 text-xs font-mono text-foreground">{approval.detail}</code>
                        </ScrollFade>
                    )}
                </motion.div>
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
                {declining ? (
                    <motion.div key="declining" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                        <DeclineReasonForm note={note} onNoteChange={setNote} onBack={() => setDeclining(false)} onConfirm={() => decide('declined', note.trim() || undefined)} disabled={locked} />
                    </motion.div>
                ) : (
                    <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex flex-wrap items-center justify-between gap-2">
                        {progress}
                        <div className="ml-auto flex items-center gap-2">
                            <Button size="sm" variant="destructive" disabled={locked} onClick={startDeclining} data-hitl="decline" aria-pressed={currentDecision?.decision === 'declined'}>
                                {currentDecision?.decision === 'declined' && <CheckIcon className="size-3.5" />}
                                {t('chat.actionApproval.decline')}
                            </Button>
                            <Button size="sm" variant="default" disabled={locked} onClick={() => decide('approved')} data-hitl="approve" aria-pressed={currentDecision?.decision === 'approved'}>
                                {currentDecision?.decision === 'approved' && <CheckIcon className="size-3.5" />}
                                {currentDecision?.decision === 'approved' ? t('chat.actionApproval.approved') : t('chat.actionApproval.approve')}
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
