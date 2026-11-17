'use client'

import type { SkillProposalDecision } from '@rerun/contracts'
import { AttentionBuddy, type InboxEntry } from '@rerun/ui/inbox'
import { Button, useScrollFade } from '@rerun/ui/primitives'
import { shortRelativeTime } from '@rerun/ui/time'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { CUE_MOTION, PendingHitlPill } from '@/components/chat/PendingHitlPill'
import { isAnswerable, PeekReceipt, PeekRequest, PeekSkeleton, usePeekAnswer } from '@/components/notifications/PendingRequestPeekBody'
import type { InboxPeek, PeekAnswerOutcome, PeekDecisionOutcome } from '@/hooks/useInboxPeek'
import { usePendingInView } from '@/hooks/usePendingInView'
import { summarizePendingHitl } from '@/lib/chat/hitl-cue'
import { ArrowLeftIcon, ArrowRight, XIcon } from '@/lib/icons'

const MAX_HEIGHT = 576
const EDGE_GAP = 12
// Room left around the request once the pill has scrolled it in.
const JUMP_GAP = 12

type InboxPeekCardProps = {
    entry: InboxEntry
    peek: InboxPeek
    onAnswer: (text: string) => Promise<PeekAnswerOutcome>
    onDecide: (proposalId: string, decision: SkillProposalDecision) => Promise<PeekDecisionOutcome>
    onClose: () => void
    /** Back to the inbox's list. */
    onBack?: () => void
    /** Left out when there is no coworker to open a conversation with. */
    onOpenConversation?: () => void
    /** The side the card is pinned by: it rises from the board's pill, or drops from a line of a list. */
    anchor?: 'bottom' | 'top'
}

/** A question, an approval, a credential request or a skill proposal, read and answered from the inbox without opening the conversation. */
export function InboxPeekCard({ entry, peek, onAnswer, onDecide, onClose, onBack, onOpenConversation, anchor = 'bottom' }: InboxPeekCardProps) {
    const t = useTranslations('notifications.inbox.peek')
    const locale = useLocale()
    const { phase, notice, attempt, submit, submitDecision } = usePeekAnswer({ answer: onAnswer, decide: onDecide }, onClose)
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const setBody = useCallback((element: HTMLDivElement | null) => {
        bodyRef.current = element
        setBodyEl(element)
    }, [])
    const widgetRef = useRef<HTMLDivElement>(null)
    const mask = useScrollFade(bodyEl)
    const reducedMotion = useReducedMotion()
    const tHitlCue = useTranslations('chat.hitlCue')
    const maxHeight = useRoomToGrow(anchor)

    const subtitle = [entry.title, entry.updatedAt && shortRelativeTime(entry.updatedAt, locale)].filter(Boolean).join(' · ')
    const pending = peek.state === 'ready' ? peek.peek.pending : null
    const answerable = pending !== null && isAnswerable(pending)
    const sent = phase.step === 'sent' || phase.step === 'decided'
    const waiting = answerable && peek.state === 'ready' && phase.step === 'asking' ? pending : null
    const widgetVisibility = usePendingInView(bodyRef, widgetRef, waiting?.toolCallId ?? null)
    const cue = useMemo(() => (waiting ? summarizePendingHitl(waiting.kind, waiting.input, tHitlCue) : null), [waiting, tHitlCue])

    // Scrolls just enough to show the whole request, its top first when it is taller than the card.
    const jumpToWidget = () => {
        const body = bodyRef.current
        const widget = widgetRef.current
        if (!body || !widget) return
        const bodyRect = body.getBoundingClientRect()
        const widgetRect = widget.getBoundingClientRect()
        const bottomIn = widgetRect.bottom - bodyRect.bottom + JUMP_GAP
        const topIn = widgetRect.top - bodyRect.top - JUMP_GAP
        body.scrollTo({ top: body.scrollTop + Math.min(bottomIn, topIn), behavior: reducedMotion ? 'auto' : 'smooth' })
    }

    return (
        <div ref={maxHeight.ref} style={{ maxHeight: maxHeight.value }} className="flex flex-col">
            <div className="flex shrink-0 items-start gap-2.5 p-3 pb-2">
                {onBack && (
                    <Button size="icon-sm" variant="ghost" aria-label={t('back')} onClick={onBack}>
                        <ArrowLeftIcon className="size-3.5" />
                    </Button>
                )}
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
                <PeekSkeleton className="px-3 pb-3" />
            ) : (
                <AnimatePresence mode="wait" initial={false}>
                    {sent ? (
                        <motion.div key="sent" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 pb-3">
                            <PeekReceipt phase={phase} pending={pending} agentId={entry.agentId} agentName={entry.agentName} />
                        </motion.div>
                    ) : (
                        <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="relative flex min-h-0 flex-1 flex-col">
                            <div ref={setBody} style={{ maskImage: mask, WebkitMaskImage: mask }} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3">
                                <PeekRequest peek={peek} phase={phase} notice={notice} attempt={attempt} agentId={entry.agentId} agentName={entry.agentName} widgetRef={widgetRef} onSubmit={text => void submit(text)} onDecide={(id, decision) => void submitDecision(id, decision)} onDismiss={onClose} />
                            </div>
                            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
                                <AnimatePresence initial={false}>
                                    {cue && widgetVisibility === 'out-of-view' && (
                                        <motion.div key="pending" {...CUE_MOTION} className="pointer-events-auto flex max-w-full justify-center">
                                            <PendingHitlPill summary={cue} onJump={jumpToWidget} />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
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
