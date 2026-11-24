'use client'

import type { CoworkerDockNote } from '@rerun/contracts'
import { AttentionBuddy } from '@rerun/ui/inbox'
import { Button } from '@rerun/ui/primitives'
import { shortRelativeTime } from '@rerun/ui/time'
import { motion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { PeekReceipt, PeekRequest, PeekSkeleton, usePeekAnswer, type PeekPhase } from '@/components/notifications/PendingRequestPeekBody'
import { Textarea } from '@/components/ui/textarea'
import { readAgentModel } from '@/hooks/useAgentModel'
import { useInboxPeek } from '@/hooks/useInboxPeek'
import { PEEK_STATUSES } from '@/lib/chat/pending-request-peek'
import { sendSessionMessage } from '@/lib/chat/send-session-message'
import { ArrowLeftIcon, ArrowRight, ArrowUpIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const MARKDOWN = 'text-sm break-words text-foreground/85 [&_code]:text-[12px] [&_p]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'

const noDecision = async () => 'stale' as const

type DockNoteDetailProps = {
    note: CoworkerDockNote
    name: string
    onBack: () => void
    onClose: () => void
    onOpenApp: () => void
    onMarkRead: () => void
    // The receipt is over: the note leaves, the card goes back to the list.
    onDone: () => void
}

/** A note opened in the dock's card: what the coworker said or asks, answered on the spot when it can be. */
export function DockNoteDetail(props: DockNoteDetailProps) {
    const { note } = props
    const peekable = PEEK_STATUSES.has(note.status) && (note.sessionId !== null || note.engineSessionId !== null)
    return (
        <>
            <NoteHeader {...props} />
            {peekable ? <RequestBody {...props} /> : <MessageBody {...props} />}
        </>
    )
}

function NoteHeader({ note, name, onBack, onClose }: DockNoteDetailProps) {
    const t = useTranslations('notifications.inbox.peek')
    const locale = useLocale()
    const subtitle = [note.title, note.updatedAt && shortRelativeTime(note.updatedAt, locale)].filter(Boolean).join(' · ')
    return (
        <div className="flex shrink-0 items-center gap-2.5 p-3 pb-2">
            <Button size="icon-sm" variant="ghost" aria-label={t('back')} onClick={onBack} className="-ms-1">
                <ArrowLeftIcon className="size-3.5" />
            </Button>
            <AttentionBuddy agentId={note.agentId} status={note.status} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{name}</span>
                {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
            </div>
            <Button size="icon-sm" variant="ghost" aria-label={t('close')} onClick={onClose}>
                <XIcon className="size-3.5" />
            </Button>
        </div>
    )
}

function RequestBody({ note, name, onBack, onOpenApp, onDone }: DockNoteDetailProps) {
    const { peek, answer, decide } = useInboxPeek({ agentId: note.agentId, sessionId: note.sessionId, engineSessionId: note.engineSessionId })
    const { phase, notice, attempt, submit, submitDecision } = usePeekAnswer({ answer, decide }, onDone)
    const pending = peek.state === 'ready' ? peek.peek.pending : null
    return (
        <>
            <Body>
                {peek.state === 'loading' ? (
                    <PeekSkeleton />
                ) : isSent(phase) ? (
                    <Receipt>
                        <PeekReceipt phase={phase} pending={pending} agentId={note.agentId} agentName={name} />
                    </Receipt>
                ) : (
                    <PeekRequest peek={peek} phase={phase} notice={notice} attempt={attempt} agentId={note.agentId} agentName={name} onSubmit={text => void submit(text)} onDecide={(id, decision) => void submitDecision(id, decision)} onDismiss={onBack} />
                )}
            </Body>
            <Footer note={note} onOpenApp={onOpenApp} />
        </>
    )
}

function MessageBody({ note, name, onOpenApp, onMarkRead, onDone }: DockNoteDetailProps) {
    const t = useTranslations('notifications.inbox.peek')
    const { sessionId } = note
    const reply = async (text: string) => (sessionId ? sendSessionMessage({ agentId: note.agentId, sessionId, text, model: readAgentModel(note.agentId, sessionId) }) : 'failed')
    const { phase, notice, submit } = usePeekAnswer({ answer: reply, decide: noDecision }, () => {
        onMarkRead()
        onDone()
    })
    const sent = isSent(phase)
    return (
        <>
            <Body>
                {sent ? (
                    <Receipt>
                        <PeekReceipt phase={phase} pending={null} agentId={note.agentId} agentName={name} />
                    </Receipt>
                ) : (
                    <>
                        <div className={cn(MARKDOWN, note.status === 'error' && 'text-destructive')}>
                            <MessageResponse>{note.text ?? note.title}</MessageResponse>
                        </div>
                        {note.status === 'done' && sessionId && <ReplyField name={name} sending={phase.step === 'sending'} onSend={text => void submit(text)} />}
                        {notice && (
                            <p role="alert" className="text-xs text-destructive">
                                {notice === 'busy' ? t('busy', { agent: name }) : t('failed')}
                            </p>
                        )}
                    </>
                )}
            </Body>
            <Footer note={note} onOpenApp={onOpenApp} onMarkRead={sent ? undefined : onMarkRead} />
        </>
    )
}

function isSent(phase: PeekPhase): phase is Extract<PeekPhase, { step: 'sent' } | { step: 'decided' }> {
    return phase.step === 'sent' || phase.step === 'decided'
}

function Body({ children }: { children: ReactNode }) {
    return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3">{children}</div>
}

function Receipt({ children }: { children: ReactNode }) {
    return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-2">
            {children}
        </motion.div>
    )
}

function ReplyField({ name, sending, onSend }: { name: string; sending: boolean; onSend: (text: string) => void }) {
    const t = useTranslations('desktopShell.coworkerDock')
    const [text, setText] = useState('')
    const send = () => {
        if (text.trim() && !sending) onSend(text.trim())
    }
    return (
        <div className="flex items-end gap-1.5 rounded-xl border bg-background/60 p-1.5 focus-within:ring-1 focus-within:ring-ring">
            <Textarea
                value={text}
                rows={1}
                onChange={event => setText(event.target.value)}
                onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        send()
                    }
                }}
                placeholder={t('replyTo', { name })}
                className="max-h-28 min-h-8 resize-none border-0 bg-transparent px-1.5 py-1.5 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <Button size="icon-sm" aria-label={t('send')} disabled={!text.trim() || sending} onClick={send}>
                <ArrowUpIcon className="size-3.5" />
            </Button>
        </div>
    )
}

function Footer({ note, onOpenApp, onMarkRead }: { note: CoworkerDockNote; onOpenApp: () => void; onMarkRead?: () => void }) {
    const t = useTranslations('desktopShell.coworkerDock')
    return (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-3 py-2">
            {onMarkRead && note.status === 'done' && (
                <Button size="sm" variant="ghost" onClick={onMarkRead}>
                    {t('markRead')}
                </Button>
            )}
            <Button size="sm" variant={note.status === 'error' ? 'default' : 'ghost'} onClick={onOpenApp}>
                {t('openInRerun')}
                <ArrowRight className="size-3.5" />
            </Button>
        </div>
    )
}
