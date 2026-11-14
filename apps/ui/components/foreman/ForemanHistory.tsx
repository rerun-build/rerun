'use client'

import { AnimatePresence } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'

import type { SessionHistoryEntry } from '@/app/api/_services/conversation.service'
import { ChatRow, groupByDay } from '@/components/agent/sheet/AgentChatsList'
import { FloatingSurface, Scrim } from '@/components/agent/sheet/floating'
import { Button } from '@/components/ui/button'
import { MessageCircle, MessagesSquare, PlusIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ForemanHistoryProps = {
    open: boolean
    entries: SessionHistoryEntry[]
    /** The conversation on screen, null on General. */
    activeThreadId: string | null
    onOpenGeneral: () => void
    onOpenThread: (sessionId: string) => void
    onNewTask: () => void
    onClose: () => void
}

/** Every conversation with the Chief of Staff, over the column: General pinned on top, its threads by day. */
export function ForemanHistory({ open, entries, activeThreadId, onOpenGeneral, onOpenThread, onNewTask, onClose }: ForemanHistoryProps) {
    const t = useTranslations('foreman.history')
    const tThreads = useTranslations('foreman.threads')
    const tHeader = useTranslations('foreman.header')
    const locale = useLocale()
    const days = groupByDay(entries, locale)
    const pick = (action: () => void) => () => {
        action()
        onClose()
    }

    return (
        <AnimatePresence>
            {open && <Scrim key="scrim" onClose={onClose} />}
            {open && (
                <FloatingSurface key="history" className="top-14 right-3 max-h-[min(32rem,calc(100%-5rem))] w-[min(360px,calc(100%-1.5rem))]">
                    <div className="flex min-h-0 flex-col">
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-1">
                            <span className="flex items-center gap-2 pl-1 text-sm font-semibold">
                                <MessageCircle className="size-4 text-muted-foreground" />
                                {t('title')}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <Button variant="outline" size="sm" onClick={pick(onNewTask)}>
                                    <PlusIcon className="size-3.5" />
                                    {tHeader('newTask')}
                                </Button>
                                <Button aria-label={t('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                                    <XIcon className="size-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="min-h-0 space-y-0.5 overflow-y-auto px-2 pb-2">
                            <button
                                type="button"
                                onClick={pick(onOpenGeneral)}
                                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors', activeThreadId === null ? 'bg-muted/60' : 'hover:bg-muted/40')}
                            >
                                <MessagesSquare className="size-3.5 text-brand-text" />
                                {tThreads('general')}
                            </button>
                            {days.map(({ day, entries: dayEntries }) => (
                                <div key={day} className="pb-1">
                                    <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{day}</p>
                                    {dayEntries.map(entry => (
                                        <ChatRow key={entry.engineSessionId} entry={entry} active={entry.id === activeThreadId} running={entry.status === 'working'} adopting={false} onOpen={pick(() => entry.id && onOpenThread(entry.id))} />
                                    ))}
                                </div>
                            ))}
                            {days.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</p>}
                        </div>
                    </div>
                </FloatingSurface>
            )}
        </AnimatePresence>
    )
}
