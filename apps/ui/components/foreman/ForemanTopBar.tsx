'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { renameSessionAction } from '@/app/api/_actions/session.actions'
import { OpenChatsTabs } from '@/components/agent/sheet/OpenChatsTabs'
import { useSessionRename } from '@/components/agent/sheet/SessionRename'
import { CloseRunningTabDialog } from '@/components/dialogs/CloseRunningTabDialog'
import type { ForemanTabs } from '@/components/foreman/useForemanTabs'
import { isGeneralTab } from '@/hooks/useSessionTabs'
import { isTypingTarget } from '@/lib/typing-target'

type ForemanTopBarProps = {
    conversations: ForemanTabs
    onNewTask: () => void
    /** What opens the bar: the button to the Chief of Staff's card. */
    start?: ReactNode
    /** The button to every conversation and the list it opens, at the end of the bar. */
    history?: ReactNode
    /** On screen and in front: its keyboard shortcuts answer. */
    active?: boolean
}

/**
 * The Chief of Staff's bar in the Simple view's middle, the one a coworker's chat has: General pinned
 * first, then the threads opened here, between its card button and its history.
 */
export function ForemanTopBar({ conversations, onNewTask, start, history, active = true }: ForemanTopBarProps) {
    const t = useTranslations('foreman.threads')
    const generalTitle = t('general')
    const { tabs, activeIndex, rowById, show, close, updateTabTitle } = conversations
    const [pendingCloseIndex, setPendingCloseIndex] = useState<number | null>(null)

    const shownTabs = useMemo(() => tabs.map(tab => (isGeneralTab(tab) ? { ...tab, title: generalTitle } : { ...tab, title: (tab.id && rowById.get(tab.id)?.title) || tab.title })), [tabs, rowById, generalTitle])

    // A thread still working asks first, as a coworker's does: closing its tab is not stopping it.
    const requestClose = useCallback(
        (index: number) => {
            if (isGeneralTab(tabs[index])) return
            const id = tabs[index]?.id
            if (id && rowById.get(id)?.status === 'working') setPendingCloseIndex(index)
            else close(index)
        },
        [tabs, rowById, close]
    )

    // Cmd/Ctrl+Backspace closes the thread on screen, outside a field where it deletes the last word.
    useEffect(() => {
        if (!active) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key !== 'Backspace') return
            if (isTypingTarget(event.target)) return
            event.preventDefault()
            requestClose(activeIndex)
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [active, requestClose, activeIndex])

    // The tab takes the new title at once: the sessions channel brings it to the list.
    const rename = useSessionRename(
        useCallback(
            async (id: string, title: string) => {
                const renamed = await renameSessionAction(id, title)
                if (renamed) updateTabTitle(id, title)
                return renamed
            },
            [updateTabTitle]
        )
    )

    return (
        <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-2">
            {start}
            <div className="min-w-0 flex-1">
                <OpenChatsTabs tabs={shownTabs} activeIndex={activeIndex} onSelect={show} onClose={requestClose} onCreate={onNewTask} rename={rename} statusOf={tab => (tab.id ? rowById.get(tab.id)?.status : undefined)} />
            </div>
            {history}
            <CloseRunningTabDialog
                open={pendingCloseIndex !== null}
                onOpenChange={open => !open && setPendingCloseIndex(null)}
                onConfirm={() => {
                    if (pendingCloseIndex !== null) close(pendingCloseIndex)
                    setPendingCloseIndex(null)
                }}
            />
        </div>
    )
}
