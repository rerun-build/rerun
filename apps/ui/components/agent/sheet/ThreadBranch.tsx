'use client'

import { Badge, Button, Stripes } from '@rerun/ui/primitives'
import { AnimatedSize } from '@rerun/ui/steps'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useLayoutEffect, useState } from 'react'

import type { ThreadRow } from '@/app/api/_services/conversation.service'
import { StateDot } from '@/components/agent/sheet/OpenChatsTabs'
import { PeekReceipt, PeekRequest, PeekSkeleton, usePeekAnswer } from '@/components/notifications/PendingRequestPeekBody'
import { useInboxPeek } from '@/hooks/useInboxPeek'
import { ATTENTION_STATUSES } from '@/lib/board/attention'
import type { SessionStatus } from '@/lib/board/types'
import { PEEK_STATUSES } from '@/lib/chat/pending-request-peek'
import { ArrowRight, CalendarClock, ChevronRightIcon, WebhookIcon } from '@/lib/icons'
import { shortRelativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'

export type ThreadState = 'live' | 'needs' | 'error' | 'done'

export function threadStateOf(status: SessionStatus): ThreadState {
    if (status === 'working') return 'live'
    if (status === 'error') return 'error'
    if (ATTENTION_STATUSES.has(status)) return 'needs'
    return 'done'
}

/** The same tones as the branches of a `call_agent` delegation (`SubRunTree`), plus orange for a thread waiting on us. */
const BRANCH_TONE: Record<ThreadState, string> = {
    live: 'border-brand/70',
    needs: 'border-orange-400/70',
    error: 'border-red-400/70',
    done: 'border-border',
}

const STATE_BADGE_TONE: Record<Exclude<ThreadState, 'done' | 'live'>, 'orange' | 'red'> = {
    needs: 'orange',
    error: 'red',
}

const THREAD_STRIPES_INK = 'color-mix(in oklab, var(--foreground) 6%, transparent)'

const ROW = 'group relative flex h-8 items-center gap-2 overflow-hidden px-2.5 text-left text-sm [&>:not(:first-child)]:relative'

const EXPANDED_MAX_WIDTH = 560
// The row's indent under the bubble, `pl-7`.
const BRANCH_INDENT = 28
// Stands for the request of a row that waits, until it is read.
const REQUEST_UNREAD = ''

// One curve for the whole morph. The width, the height and the content move together, both ways: the
// body is revealed by its own growing height, never shown as an empty frame waiting for its content.
// Closing, the width waits a beat so the card folds before it narrows back to a row.
const EASE = [0.32, 0.72, 0, 1] as const
const GROW: Transition = { duration: 0.34, ease: EASE }
const SHRINK_WIDTH: Transition = { duration: 0.28, ease: EASE, delay: 0.08 }
const BODY_IN: Transition = { height: GROW, opacity: { duration: 0.22, ease: 'easeOut' } }
const BODY_OUT: Transition = { height: { duration: 0.28, ease: EASE }, opacity: { duration: 0.16, ease: 'easeIn' } }
const INSTANT: Transition = { duration: 0 }

const isAutomated = (thread: ThreadRow) => thread.source === 'schedule' || thread.source === 'trigger'

/** The coworker whose thread it is: given, a thread that waits on an answer unfolds into its request instead of opening its tab. */
export type ThreadPeekOwner = { agentId: string; agentName: string }

// What stands in for the opening message when the hub never saw one: a run the engine started, a
// coworker's request, or a thread older than the column that keeps it.
function genericOpener(thread: ThreadRow, originAgentName: string | null, t: ReturnType<typeof useTranslations<'agent.threadBranch.opener'>>): string {
    if (thread.source === 'schedule') return t('schedule', { name: thread.automationName ?? thread.title })
    if (thread.source === 'trigger') return t('trigger', { name: thread.automationName ?? thread.title })
    if (thread.source === 'agent' || thread.source === 'delegate') return originAgentName ? t('askedBy', { name: originAgentName }) : t('askedByUnknown')
    return t('started')
}

/**
 * A thread in General: the message it opened with, in a small bubble, and under it the thread's
 * row, joined by a curve that leaves the bubble's bottom like a delegation's branches in
 * `SubRunTree`. The row is hatched rather than filled, so it never reads as one more bubble, and a
 * click on it opens the thread in its tab. With its `owner`, a row that waits on an answer grows
 * into its request instead, see `ThreadPeek`.
 */
export function ThreadBranch({ thread, onOpen, owner }: { thread: ThreadRow; onOpen: () => void; owner?: ThreadPeekOwner }) {
    const tOpener = useTranslations('agent.threadBranch.opener')
    const state = threadStateOf(thread.status)
    const originAgentName = useBoardStore(s => (thread.originAgentId ? (s.agents.find(agent => agent.id === thread.originAgentId)?.name ?? null) : null))
    const opener = thread.firstMessage ?? genericOpener(thread, originAgentName, tOpener)
    const title = thread.automationName && thread.automationName !== thread.title ? thread.automationName : undefined
    const peekable = owner !== undefined && PEEK_STATUSES.has(thread.status)
    // Only a row that waits on an answer, or did, carries the card: General hangs up to 200 threads,
    // and the others stay a plain button. Never taken back, so the receipt is not cut by a remount.
    const [peeked, setPeeked] = useState(peekable)
    if (peekable && !peeked) setPeeked(true)
    return (
        <div className="flex w-full flex-col gap-2" data-thread-row={thread.id}>
            {/* The clamp sits on an inner span: on the padded box itself, a third line would show through the bottom padding. Its right padding keeps the overhang of a last italic glyph. */}
            <div className={cn('w-fit max-w-full rounded-2xl rounded-bl-md bg-muted px-3 py-1.5 text-xs text-foreground/80', !thread.firstMessage && 'text-muted-foreground italic')}>
                <span className="line-clamp-2 pr-0.5 break-words">{opener}</span>
            </div>
            {owner && peeked ? (
                <ThreadPeek thread={thread} state={state} peekable={peekable} owner={owner} title={title} onOpen={onOpen} />
            ) : (
                <div className="relative w-full pl-7">
                    <BranchCurve state={state} />
                    <button type="button" onClick={onOpen} title={title} className={cn(ROW, 'max-w-full rounded-lg border border-border transition-colors hover:border-foreground/20')}>
                        <RowStripes />
                        <ThreadRowContent thread={thread} state={state} badged open={false} />
                    </button>
                </div>
            )}
        </div>
    )
}

/**
 * The row and the request it waits on, as one element: the row stays on top as its header. A click
 * on a row that waits on an answer unfolds the request under it, the row folds it back, the footer
 * goes to the conversation. Once answered, the receipt shows for a moment, then it folds back to a
 * row without its badge. The request is read as soon as the row waits, so the click unfolds it in
 * one movement.
 */
function ThreadPeek({ thread, state, peekable, owner, title, onOpen }: { thread: ThreadRow; state: ThreadState; peekable: boolean; owner: ThreadPeekOwner; title: string | undefined; onOpen: () => void }) {
    const t = useTranslations('notifications.inbox.peek')
    const reducedMotion = useReducedMotion()
    const [expanded, setExpanded] = useState(false)
    // The thread moves when it is answered too: read again only once the answer and its receipt are
    // over, so neither loses the request it is about.
    const [readAt, setReadAt] = useState(thread.updatedAt)
    const { peek, answer, decide } = useInboxPeek({ agentId: owner.agentId, sessionId: thread.id, engineSessionId: null }, peekable, readAt)
    const fold = useCallback(() => setExpanded(false), [])
    // The body that folds away keeps the receipt it was showing: the row is ready for the next request at once.
    const { phase, notice, attempt, submit, submitDecision, rearm } = usePeekAnswer({ answer, decide }, rearmAfterReceipt => {
        fold()
        rearmAfterReceipt()
    })
    const [measureColumn, columnWidth] = useMeasuredWidth()
    const [measureRow, rowWidth] = useMeasuredWidth()
    const sent = phase.step === 'sent' || phase.step === 'decided'
    const sending = phase.step === 'sending'
    const pending = peek.state === 'ready' ? peek.peek.pending : null
    const proposalId = peek.state === 'ready' ? (peek.peek.proposal?.id ?? null) : null
    if (!sending && !sent && readAt !== thread.updatedAt) setReadAt(thread.updatedAt)

    // The row outlives its requests: the one it waits on now, null once it waits on none. What was
    // left of the previous one (a card left open, an answer that came too late) goes with it, so the
    // next request starts folded on a fresh form. An answer on its way keeps its card: the receipt folds it.
    const request = peekable ? (pending?.toolCallId ?? proposalId ?? REQUEST_UNREAD) : null
    const [shownRequest, setShownRequest] = useState(request)
    if (shownRequest !== request) {
        setShownRequest(request)
        if (!sending && !sent) {
            if (shownRequest === null || request === null) setExpanded(false)
            rearm()
        }
    }

    // The status may say the coworker is working again before the answer's own request comes back.
    const open = expanded && (peekable || sending || sent)
    // The column's width, minus the branch's indent: what the card takes once open, and the most a
    // row takes. Two px of border around the row's own width.
    const room = columnWidth === null ? null : columnWidth - BRANCH_INDENT
    const collapsedWidth = rowWidth === null ? null : Math.min(rowWidth + 2, room ?? Infinity)
    const openWidth = room === null ? null : Math.min(EXPANDED_MAX_WIDTH, room)
    const width = open ? openWidth : collapsedWidth

    const toggle = () => (peekable || open ? setExpanded(!open) : onOpen())
    const openConversation = () => {
        fold()
        onOpen()
    }

    return (
        <div ref={measureColumn} className="relative w-full pl-7">
            <BranchCurve state={sent ? 'done' : state} />
            <motion.div initial={false} animate={width === null ? undefined : { width }} transition={reducedMotion ? INSTANT : open ? GROW : SHRINK_WIDTH} className={cn('relative w-fit max-w-full overflow-hidden rounded-lg border transition-[background-color,border-color,box-shadow] duration-300', open ? 'border-foreground/15 bg-card shadow-sm' : 'border-border hover:border-foreground/20')}>
                {/* The row as it sits collapsed, on one line and never seen: its width is the one the element folds back to. */}
                <div ref={measureRow} aria-hidden className={cn(ROW, 'invisible absolute top-0 left-0 w-max whitespace-nowrap')}>
                    <ThreadRowContent thread={thread} state={state} badged={!sent} open={false} stretch />
                </div>
                <button type="button" aria-expanded={peekable ? open : undefined} onClick={toggle} title={title} className={cn(ROW, 'w-full')}>
                    <RowStripes />
                    <ThreadRowContent thread={thread} state={state} badged={!sent} open={open} stretch />
                </button>

                <AnimatePresence initial={false}>
                    {open && (
                        <motion.div key="request" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1, transition: reducedMotion ? INSTANT : BODY_IN }} exit={{ height: 0, opacity: 0, transition: reducedMotion ? INSTANT : BODY_OUT }} className="overflow-hidden">
                            {/* Laid out at its final width from the first frame: the frame reveals it as it widens, the text never reflows mid-morph. */}
                            <div style={{ width: openWidth === null ? undefined : openWidth - 2 }}>
                                <AnimatedSize transition={reducedMotion ? INSTANT : GROW}>
                                    <div className="flex flex-col gap-3 border-t border-border p-3">
                                        {peek.state === 'loading' ? (
                                            <PeekSkeleton />
                                        ) : sent ? (
                                            <div className="flex flex-col gap-2">
                                                <PeekReceipt phase={phase} pending={pending} agentId={owner.agentId} agentName={owner.agentName} />
                                            </div>
                                        ) : (
                                            <PeekRequest peek={peek} phase={phase} notice={notice} attempt={attempt} agentId={owner.agentId} agentName={owner.agentName} onSubmit={text => void submit(text)} onDecide={(id, decision) => void submitDecision(id, decision)} onDismiss={fold} />
                                        )}
                                    </div>
                                </AnimatedSize>
                                <div className="flex justify-end border-t border-border px-2 py-1.5">
                                    <Button size="sm" variant="ghost" onClick={openConversation}>
                                        {t('openConversation')}
                                        <ArrowRight className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    )
}

// Widths are animated in pixels: `auto` and `fit-content` cannot be interpolated, and motion's `layout`
// scales the content while it runs, which stretches the row's text.
function useMeasuredWidth(): [(element: HTMLDivElement | null) => void, number | null] {
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    const [value, setValue] = useState<number | null>(null)
    useLayoutEffect(() => {
        if (!element) return
        const measure = () => setValue(element.offsetWidth)
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        measure()
        return () => observer.disconnect()
    }, [element])
    return [setElement, value]
}

function BranchCurve({ state }: { state: ThreadState }) {
    return <span aria-hidden className={cn('absolute -top-2 left-3.5 h-6 w-3 rounded-bl-md border-b border-l transition-colors duration-500', BRANCH_TONE[state])} />
}

// Turned half a turn, the hatch keeps its slant and fades toward the title instead of the chevron.
function RowStripes() {
    return <Stripes fade="right" color={THREAD_STRIPES_INK} band={4} period={8} className="rotate-180 opacity-60 transition-opacity group-hover:opacity-100" />
}

// `stretch` pushes the time and the chevron to the right edge of a row that widens into a card.
function ThreadRowContent({ thread, state, badged, open, stretch = false }: { thread: ThreadRow; state: ThreadState; badged: boolean; open: boolean; stretch?: boolean }) {
    const t = useTranslations('agent.threadBranch')
    const locale = useLocale()
    const SourceIcon = thread.source === 'trigger' ? WebhookIcon : CalendarClock
    const badge = badged && (state === 'needs' || state === 'error') ? { label: t(state), tone: STATE_BADGE_TONE[state] } : null
    return (
        <>
            {state === 'live' && <StateDot state="live" />}
            {isAutomated(thread) && <SourceIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className={cn('min-w-0 truncate font-medium', stretch && 'flex-1', thread.outcome === 'failed' && 'text-destructive', thread.outcome === 'nothing' && 'text-muted-foreground')}>{thread.title}</span>
            {badge && (
                <Badge size="xs" tone={badge.tone} glow={false} className="shrink-0">
                    {badge.label}
                </Badge>
            )}
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{shortRelativeTime(thread.createdAt, locale)}</span>
            <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-300', open ? 'rotate-90' : 'group-hover:translate-x-0.5')} />
        </>
    )
}
