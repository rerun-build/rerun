'use client'

import { needsHuman } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import type { SessionHistoryEntry } from '@/app/api/_services/conversation.service'
import { ChatRow, groupByDay } from '@/components/agent/sheet/AgentChatsList'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { HistoryIcon, MessageCircle, MessagesSquare, PlusIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ForemanHistoryProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    // A thread waits on the person: the button's dot.
    waiting: boolean
    entries: SessionHistoryEntry[]
    /** The conversation on screen, null on General. */
    activeThreadId: string | null
    onOpenGeneral: () => void
    onOpenThread: (sessionId: string) => void
    onNewTask: () => void
    /** At the start of the bar over the chat, where a coworker keeps its conversations: their button, and the list opens under it. */
    inBar?: boolean
}

/** Every conversation with the Chief of Staff, under its button in the header: General pinned on top, its threads by day. */
export function ForemanHistory({ open, onOpenChange, waiting, entries, activeThreadId, onOpenGeneral, onOpenThread, onNewTask, inBar = false }: ForemanHistoryProps) {
    const t = useTranslations('foreman.history')
    const tThreads = useTranslations('foreman.threads')
    const tHeader = useTranslations('foreman.header')
    const tList = useTranslations('agent.agentChatsList')
    const locale = useLocale()
    // As a coworker's list: every thread, or the ones waiting on the person.
    const [filter, setFilter] = useState<'all' | 'needs'>('all')
    const waitingEntries = entries.filter(entry => needsHuman(entry.status))
    const days = groupByDay(filter === 'needs' ? waitingEntries : entries, locale)
    const onClose = () => onOpenChange(false)
    const pick = (action: () => void) => () => {
        action()
        onClose()
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <TooltipLabeled label={tHeader('conversations')} side="bottom">
                <PopoverTrigger asChild>
                    {inBar ? (
                        <Button variant="ghost" size="icon-sm" aria-label={tHeader('conversations')} className={cn(open && 'bg-accent')}>
                            <span className="relative flex">
                                <MessageCircle className="size-4" />
                                {waiting && <span aria-hidden className="absolute -top-1 -end-1 size-2 rounded-full bg-red-500 ring-2 ring-background" />}
                            </span>
                        </Button>
                    ) : (
                        <Button variant="ghost" size="icon-sm" aria-label={tHeader('conversations')} className="relative">
                            <HistoryIcon className="size-3.5" />
                            {waiting && <span aria-hidden className="absolute top-1 end-1 size-1.5 rounded-full bg-amber-400" />}
                        </Button>
                    )}
                </PopoverTrigger>
            </TooltipLabeled>
            {/* A React child of the header, whose pointer down drags the column and resizes its sheet: a press in the list stops here. */}
            <PopoverContent align="end" onPointerDown={event => event.stopPropagation()} className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(360px,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0">
                <div className="flex min-h-0 flex-col">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3 pb-1">
                        <span className="flex items-center gap-2 ps-1 text-sm font-semibold">
                            <MessageCircle className="size-4 text-muted-foreground" />
                            {t('title')}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <Button variant="outline" size="sm" onClick={pick(onNewTask)}>
                                <PlusIcon className="size-3.5" />
                                {tHeader('newConversation')}
                            </Button>
                            <Button aria-label={t('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                                <XIcon className="size-4" />
                            </Button>
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-1.5">
                        <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>
                            {tList('filters.all')}
                        </Chip>
                        <Chip selected={filter === 'needs'} onClick={() => setFilter('needs')}>
                            {tList('filters.needs')} <span className={cn('ms-1 tabular-nums', filter === 'needs' ? 'text-background/60' : 'text-muted-foreground/70')}>{waitingEntries.length}</span>
                        </Chip>
                    </div>
                    <div className="min-h-0 space-y-0.5 overflow-y-auto px-2 pb-2">
                        {filter === 'all' && (
                            <button
                                type="button"
                                onClick={pick(onOpenGeneral)}
                                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm font-medium transition-colors', activeThreadId === null ? 'bg-muted/60' : 'hover:bg-muted/40')}
                            >
                                <MessagesSquare className="size-3.5 text-brand-text" />
                                {tThreads('general')}
                            </button>
                        )}
                        {days.map(({ day, entries: dayEntries }) => (
                            <div key={day} className="pb-1">
                                <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{day}</p>
                                {dayEntries.map(entry => (
                                    <ChatRow key={entry.engineSessionId} entry={entry} active={entry.id === activeThreadId} running={entry.status === 'working'} adopting={false} onOpen={pick(() => entry.id && onOpenThread(entry.id))} />
                                ))}
                            </div>
                        ))}
                        {days.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{filter === 'needs' ? tList('emptyNeeds') : t('empty')}</p>}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
