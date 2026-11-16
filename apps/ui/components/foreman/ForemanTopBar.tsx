'use client'

import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { OpenChatsTabs } from '@/components/agent/sheet/OpenChatsTabs'
import type { SessionTab } from '@/hooks/useSessionTabs'
import type { SessionStatus } from '@/lib/board/types'

type ForemanTopBarProps = {
    /** The thread on screen, null on General. */
    thread: { id: string; title: string; status: SessionStatus | null } | null
    onShowGeneral: () => void
    onNewTask: () => void
    /** The button to every conversation and the list it opens. */
    history?: ReactNode
    end?: ReactNode
}

/**
 * The Chief of Staff's bar in the Simple view's middle, the one a coworker's chat has: its conversations,
 * General pinned first and the thread on screen beside it, then what sits at the end.
 */
export function ForemanTopBar({ thread, onShowGeneral, onNewTask, history, end }: ForemanTopBarProps) {
    const t = useTranslations('foreman.threads')
    const tabs: SessionTab[] = [{ uid: 'general', id: null, title: t('general'), kind: 'general' }, ...(thread ? [{ uid: thread.id, id: thread.id, title: thread.title }] : [])]

    return (
        <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-2">
            {history}
            <div className="min-w-0 flex-1">
                <OpenChatsTabs
                    tabs={tabs}
                    activeIndex={thread ? 1 : 0}
                    onSelect={index => index === 0 && onShowGeneral()}
                    onClose={onShowGeneral}
                    onCreate={onNewTask}
                    statusOf={tab => (tab.kind === 'general' ? undefined : (thread?.status ?? undefined))}
                />
            </div>
            {end}
        </div>
    )
}
