'use client'

import { AttentionBuddy, type InboxEntry } from '@rerun/ui/inbox'
import { Button, Skeleton, useScrollFade } from '@rerun/ui/primitives'
import { shortRelativeTime } from '@rerun/ui/time'
import { AnimatePresence, motion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { ActionApprovalBlock } from '@/components/chat/ActionApprovalBlock'
import { HitlReceipt } from '@/components/chat/HitlReceipt'
import { QuestionForm } from '@/components/chat/QuestionForm'
import { SecretRequestBlock } from '@/components/chat/SecretRequestBlock'
import type { InboxPeek, PeekAnswerOutcome } from '@/hooks/useInboxPeek'
import { HITL_CANCELLED, parseHitlReply, pendingApprovals, pendingQuestions, pendingSecrets, serializeApprovalDecisions } from '@/lib/chat-hitl'
import type { PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { ArrowRight, ChevronDown, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const RECEIPT_MS = 2600
const MAX_HEIGHT = 576
const EDGE_GAP = 12

const MARKDOWN = 'text-sm break-words [&_li]:my-0.5 [&_ol]:my-1 [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'

type Pending = NonNullable<PendingRequestPeek['pending']>

type InboxPeekCardProps = {
    entry: InboxEntry
    peek: InboxPeek
    onAnswer: (text: string) => Promise<PeekAnswerOutcome>
    onClose: () => void
    /** Left out when there is no coworker to open a conversation with. */
    onOpenConversation?: () => void
    /** The side the card is pinned by: it rises from the board's pill, or drops from a line of a list. */
    anchor?: 'bottom' | 'top'
}

type Phase = { step: 'asking' } | { step: 'sending' } | { step: 'sent'; text: string } | { step: 'stale' }

/** A question, an approval or a credential request, read and answered from the inbox without opening the conversation. */
export function InboxPeekCard({ entry, peek, onAnswer, onClose, onOpenConversation, anchor = 'bottom' }: InboxPeekCardProps) {
    const t = useTranslations('notifications.inbox.peek')
    const locale = useLocale()
    const [phase, setPhase] = useState<Phase>({ step: 'asking' })
    const [notice, setNotice] = useState<'busy' | 'failed' | null>(null)
    // A widget latches once submitted: a failed send gives a fresh one back.
    const [attempt, setAttempt] = useState(0)
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
    const mask = useScrollFade(bodyEl)
    const maxHeight = useRoomToGrow(anchor)

    useEffect(() => {
        if (phase.step !== 'sent') return
        const timer = setTimeout(onClose, RECEIPT_MS)
        return () => clearTimeout(timer)
    }, [phase.step, onClose])

    const submit = async (text: string) => {
        setNotice(null)
        setPhase({ step: 'sending' })
        const outcome = await onAnswer(text)
        if (outcome === 'sent') return setPhase({ step: 'sent', text })
        if (outcome === 'stale') return setPhase({ step: 'stale' })
        setNotice(outcome)
        setAttempt(value => value + 1)
        setPhase({ step: 'asking' })
    }

    const subtitle = [entry.title, entry.updatedAt && shortRelativeTime(entry.updatedAt, locale)].filter(Boolean).join(' · ')
    const pending = peek.state === 'ready' ? peek.peek.pending : null
    const answerable = pending !== null && isAnswerable(pending)
    const sent = phase.step === 'sent'

    return (
        <div ref={maxHeight.ref} style={{ maxHeight: maxHeight.value }} className="flex flex-col">
            <div className="flex shrink-0 items-start gap-2.5 p-3 pb-2">
                <AttentionBuddy agentId={entry.agentId} status={sent ? 'done' : entry.status} />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{entry.agentName}</span>
                    {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={t('close')} onClick={onClose}>
                    <XIcon className="size-3.5" />
                </Button>
            </div>

            {peek.state === 'loading' ? (
                <PeekSkeleton />
            ) : (
                <AnimatePresence mode="wait" initial={false}>
                    {sent ? (
                        <motion.div key="sent" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 pb-3">
                            <p className="text-sm font-medium text-foreground">{t('sent', { agent: entry.agentName })}</p>
                            <SentReceipt text={phase.text} pending={pending} agentId={entry.agentId} />
                        </motion.div>
                    ) : (
                        <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex min-h-0 flex-1 flex-col">
                            <div ref={setBodyEl} style={{ maskImage: mask, WebkitMaskImage: mask }} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3">
                                {peek.state === 'ready' && (peek.peek.before || peek.peek.ask) && <ThreadContext before={peek.peek.before} ask={peek.peek.ask} />}
                                {phase.step === 'stale' || (peek.state === 'ready' && !pending) ? (
                                    <PeekNote>{t('stale')}</PeekNote>
                                ) : answerable && peek.state === 'ready' ? (
                                    <div className={cn(phase.step === 'sending' && 'pointer-events-none opacity-60')}>
                                        <PeekWidget key={attempt} pending={pending} agentId={entry.agentId} sessionId={peek.sessionId} onSubmit={text => void submit(text)} onClose={onClose} />
                                    </div>
                                ) : (
                                    <PeekNote>{t('openToAnswer')}</PeekNote>
                                )}
                                {notice && (
                                    <p role="alert" className="text-xs text-destructive">
                                        {notice === 'busy' ? t('busy', { agent: entry.agentName }) : t('failed')}
                                    </p>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {onOpenConversation && (
                <div className="flex shrink-0 justify-end border-t border-border px-3 py-2">
                    <Button size="sm" variant="ghost" onClick={onOpenConversation}>
                        {t('openConversation')}
                        <ArrowRight className="size-3.5" />
                    </Button>
                </div>
            )}
        </div>
    )
}

// The pill is not always at the foot of the window: on a phone it sits above the chat sheet. The card
// grows away from the side it is pinned by, up to the window's edge, and scrolls inside past that.
function useRoomToGrow(anchor: 'bottom' | 'top') {
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    const [value, setValue] = useState(MAX_HEIGHT)
    useLayoutEffect(() => {
        if (!element) return
        const measure = () => {
            const rect = element.getBoundingClientRect()
            const room = anchor === 'bottom' ? rect.bottom - EDGE_GAP : window.innerHeight - rect.top - EDGE_GAP
            setValue(Math.max(160, Math.min(MAX_HEIGHT, Math.round(room))))
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [element, anchor])
    return { ref: setElement, value }
}

const ANSWERABLE = new Set<Pending['kind']>(['question', 'approval', 'secret'])

// The other requests (an app to connect, a sign-in, a spend, the browser) need the chat around them.
function isAnswerable(pending: Pending): boolean {
    return ANSWERABLE.has(pending.kind)
}

// The card's header carries the close button; the credential block keeps its own, which only puts the card away.
function PeekWidget({ pending, agentId, sessionId, onSubmit, onClose }: { pending: Pending; agentId: string; sessionId: string; onSubmit: (text: string) => void; onClose: () => void }) {
    if (pending.kind === 'question') return <QuestionForm inline target={{ kind: 'agent', agentId }} questions={pendingQuestions(pending.input)} onSend={onSubmit} />
    if (pending.kind === 'approval') return <ActionApprovalBlock inline approvals={pendingApprovals(pending.input)} onSubmit={decisions => onSubmit(serializeApprovalDecisions(decisions))} />
    return (
        <SecretRequestBlock
            inline
            agentId={agentId}
            sessionId={sessionId}
            secrets={pendingSecrets(pending.input)}
            reason={typeof pending.input.reason === 'string' ? pending.input.reason : undefined}
            onDone={onSubmit}
            onSkip={() => onSubmit(HITL_CANCELLED.secret)}
            onDismiss={onClose}
        />
    )
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

function SentReceipt({ text, pending, agentId }: { text: string; pending: Pending | null; agentId: string }) {
    const reply = parseHitlReply(text)
    if (!reply) return null
    return <HitlReceipt reply={reply} call={pending ? { type: 'dynamic-tool', input: pending.input } : undefined} agentId={agentId} />
}

function PeekNote({ children }: { children: ReactNode }) {
    return <p className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">{children}</p>
}

// Shaped on the loaded card: the context block, then a question with three options.
function PeekSkeleton() {
    return (
        <div className="flex flex-col gap-3 px-3 pb-3">
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
