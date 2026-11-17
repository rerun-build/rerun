'use client'

import type { SkillProposal, SkillProposalDecision } from '@rerun/contracts'
import { Skeleton } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { ActionApprovalBlock } from '@/components/chat/ActionApprovalBlock'
import { HitlReceipt } from '@/components/chat/HitlReceipt'
import { QuestionForm } from '@/components/chat/QuestionForm'
import { SecretRequestBlock } from '@/components/chat/SecretRequestBlock'
import { SkillProposalBlock } from '@/components/chat/SkillProposalBlock'
import type { InboxPeek, PeekAnswerOutcome, PeekDecisionOutcome } from '@/hooks/useInboxPeek'
import { HITL_CANCELLED, parseHitlReply, pendingApprovals, pendingQuestions, pendingSecrets, serializeApprovalDecisions } from '@/lib/chat-hitl'
import type { PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { ChevronDown } from '@/lib/icons'
import { cn } from '@/lib/utils'

const RECEIPT_MS = 2600

const MARKDOWN = 'text-sm break-words [&_li]:my-0.5 [&_ol]:my-1 [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'

export type PendingRequest = NonNullable<PendingRequestPeek['pending']>

export type PeekPhase = { step: 'asking' } | { step: 'sending' } | { step: 'sent'; text: string } | { step: 'decided'; proposal: SkillProposal } | { step: 'stale' }

type PeekReceiptPhase = Extract<PeekPhase, { step: 'sent' } | { step: 'decided' }>

type PeekActions = {
    answer: (text: string) => Promise<PeekAnswerOutcome>
    decide: (proposalId: string, decision: SkillProposalDecision) => Promise<PeekDecisionOutcome>
}

export type PeekNotice = 'busy' | 'failed'

const ANSWERABLE = new Set<PendingRequest['kind']>(['question', 'approval', 'secret'])

// The other requests (an app to connect, a sign-in, a spend, the browser) need the chat around them.
export function isAnswerable(pending: PendingRequest): boolean {
    return ANSWERABLE.has(pending.kind)
}

/**
 * Sends an answer to a peeked request, or a decision on a skill proposal, shows the receipt for a
 * moment, then hands over to `onDone`. A card that leaves keeps its receipt while it goes; one that
 * stays calls `rearm` for the next request, and when the request it was showing is gone.
 */
export function usePeekAnswer({ answer, decide }: PeekActions, onDone: (rearm: () => void) => void) {
    const [phase, setPhase] = useState<PeekPhase>({ step: 'asking' })
    const [notice, setNotice] = useState<PeekNotice | null>(null)
    // A widget latches once submitted: a failed send gives a fresh one back.
    const [attempt, setAttempt] = useState(0)
    // Read when the receipt is over, so a caller's inline callback never restarts the receipt's timer.
    const onDoneRef = useRef(onDone)
    useEffect(() => {
        onDoneRef.current = onDone
    })

    const rearm = useCallback(() => {
        setNotice(null)
        setPhase(current => (current.step === 'asking' ? current : { step: 'asking' }))
    }, [])

    useEffect(() => {
        if (phase.step !== 'sent' && phase.step !== 'decided') return
        const timer = setTimeout(() => onDoneRef.current(rearm), RECEIPT_MS)
        return () => clearTimeout(timer)
    }, [phase.step, rearm])

    const fail = (outcome: PeekNotice) => {
        setNotice(outcome)
        setAttempt(value => value + 1)
        setPhase({ step: 'asking' })
    }

    const submit = async (text: string) => {
        setNotice(null)
        setPhase({ step: 'sending' })
        const outcome = await answer(text)
        if (outcome === 'sent') return setPhase({ step: 'sent', text })
        if (outcome === 'stale') return setPhase({ step: 'stale' })
        fail(outcome)
    }

    const submitDecision = async (proposalId: string, decision: SkillProposalDecision) => {
        setNotice(null)
        setPhase({ step: 'sending' })
        const outcome = await decide(proposalId, decision).catch((): PeekDecisionOutcome => 'failed')
        if (outcome === 'stale') return setPhase({ step: 'stale' })
        if (outcome === 'failed') return fail('failed')
        setPhase({ step: 'decided', proposal: outcome.proposal })
    }

    return { phase, notice, attempt, submit, submitDecision, rearm }
}

type PeekRequestProps = {
    peek: Extract<InboxPeek, { state: 'ready' } | { state: 'unreadable' }>
    phase: PeekPhase
    notice: PeekNotice | null
    attempt: number
    agentId: string
    agentName: string
    widgetRef?: Ref<HTMLDivElement>
    onSubmit: (text: string) => void
    onDecide: (proposalId: string, decision: SkillProposalDecision) => void
    /** The credential block's own close button: it only puts the request away. */
    onDismiss: () => void
}

/** What a conversation waits on, with the form that answers it: the context, the widget or why it cannot be answered here, and a failed send. */
export function PeekRequest({ peek, phase, notice, attempt, agentId, agentName, widgetRef, onSubmit, onDecide, onDismiss }: PeekRequestProps) {
    const t = useTranslations('notifications.inbox.peek')
    const pending = peek.state === 'ready' ? peek.peek.pending : null
    // A request that pauses the run comes first: the proposal still waits in the chat's dock.
    const proposal = peek.state === 'ready' && !pending ? peek.peek.proposal : null
    const sending = phase.step === 'sending'
    return (
        <>
            {peek.state === 'ready' && (peek.peek.before || peek.peek.ask) && <ThreadContext before={peek.peek.before} ask={peek.peek.ask} />}
            {phase.step === 'stale' || (peek.state === 'ready' && !pending && !proposal) ? (
                <PeekNote>{t('stale')}</PeekNote>
            ) : pending && isAnswerable(pending) && peek.state === 'ready' ? (
                <div ref={widgetRef} className={cn(sending && 'pointer-events-none opacity-60')}>
                    <PeekWidget key={attempt} pending={pending} agentId={agentId} sessionId={peek.sessionId} onSubmit={onSubmit} onDismiss={onDismiss} />
                </div>
            ) : proposal ? (
                <SkillProposalBlock key={attempt} agentId={agentId} proposal={proposal} pinned pending={sending} onDecide={onDecide} />
            ) : (
                <PeekNote>{t('openToAnswer')}</PeekNote>
            )}
            {notice && (
                <p role="alert" className="text-xs text-destructive">
                    {notice === 'busy' ? t('busy', { agent: agentName }) : t('failed')}
                </p>
            )}
        </>
    )
}

/** What was sent to the coworker, in the words of the conversation's own receipt, or the proposal as the decision left it. */
export function PeekReceipt({ phase, pending, agentId, agentName }: { phase: PeekReceiptPhase; pending: PendingRequest | null; agentId: string; agentName: string }) {
    const t = useTranslations('notifications.inbox.peek')
    if (phase.step === 'decided') return <SkillProposalBlock agentId={agentId} proposal={phase.proposal} pinned />
    const reply = parseHitlReply(phase.text)
    return (
        <>
            <p className="text-sm font-medium text-foreground">{t('sent', { agent: agentName })}</p>
            {reply && <HitlReceipt reply={reply} call={pending ? { type: 'dynamic-tool', input: pending.input } : undefined} agentId={agentId} />}
        </>
    )
}

function PeekWidget({ pending, agentId, sessionId, onSubmit, onDismiss }: { pending: PendingRequest; agentId: string; sessionId: string; onSubmit: (text: string) => void; onDismiss: () => void }) {
    if (pending.kind === 'question') return <QuestionForm inline target={{ kind: 'agent', agentId }} questions={pendingQuestions(pending.input)} onSend={onSubmit} />
    if (pending.kind === 'approval') return <ActionApprovalBlock inline approvals={pendingApprovals(pending.input)} onSubmit={decisions => onSubmit(serializeApprovalDecisions(decisions))} />
    return <SecretRequestBlock inline agentId={agentId} sessionId={sessionId} secrets={pendingSecrets(pending.input)} reason={typeof pending.input.reason === 'string' ? pending.input.reason : undefined} onDone={onSubmit} onSkip={() => onSubmit(HITL_CANCELLED.secret)} onDismiss={onDismiss} />
}

// The agent's turn before the ask folds to two lines until asked for.
function ThreadContext({ before, ask }: { before: string | null; ask: string }) {
    const t = useTranslations('notifications.inbox.peek')
    const [expanded, setExpanded] = useState(false)
    return (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2.5">
            {before && (
                <div className="flex flex-col items-start gap-1">
                    <div className={cn(MARKDOWN, 'text-muted-foreground', !expanded && 'line-clamp-2')}>
                        <MessageResponse>{before}</MessageResponse>
                    </div>
                    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                        {expanded ? t('showLess') : t('showMore')}
                        <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
                    </button>
                </div>
            )}
            {ask && (
                <div className={cn(MARKDOWN, 'text-foreground/80')}>
                    <MessageResponse>{ask}</MessageResponse>
                </div>
            )}
        </div>
    )
}

function PeekNote({ children }: { children: ReactNode }) {
    return <p className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">{children}</p>
}

// Shaped on the loaded request: the context block, then a question with three options.
export function PeekSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn('flex flex-col gap-3', className)}>
            <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2.5">
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-2/3" />
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
                <Skeleton className="h-4 w-3/4" />
                {[0.55, 0.4, 0.5].map(width => (
                    <div key={width} className="flex items-center gap-3">
                        <Skeleton className="size-7 shrink-0 rounded-md" />
                        <Skeleton className="h-3.5" style={{ width: `${width * 100}%` }} />
                    </div>
                ))}
            </div>
        </div>
    )
}
