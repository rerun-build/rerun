'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'

import type { ThreadRow } from '@/app/api/_services/conversation.service'
import { OpenChatsTabs } from '@/components/agent/sheet/OpenChatsTabs'
import { isGeneralTab, useSessionTabs } from '@/hooks/useSessionTabs'
import { useSession } from '@/supabase/session/SessionProvider'

type ForemanTopBarProps = {
    /** The conversation on screen: General's id, or one of its threads. */
    sessionId: string
    inThread: boolean
    /** The thread on screen is a "New conversation" nobody has written in yet. */
    blankDraft: boolean
    threads: ThreadRow[]
    onShowGeneral: () => void
    onOpenThread: (id: string) => void
    onNewTask: () => void
    /** What opens the bar: the button to the Chief of Staff's card. */
    start?: ReactNode
    /** The button to every conversation and the list it opens, at the end of the bar. */
    history?: ReactNode
}

/**
 * The Chief of Staff's bar in the Simple view's middle, the one a coworker's chat has: General pinned
 * first, then the threads opened here, kept across reloads, between its card button and its history. The store says
 * which conversation is on screen; the tabs follow it, whoever opened it (+, the history, a notification).
 */
export function ForemanTopBar({ sessionId, inThread, blankDraft, threads, onShowGeneral, onOpenThread, onNewTask, start, history }: ForemanTopBarProps) {
    const t = useTranslations('foreman.threads')
    const generalTitle = t('general')
    const untitled = t('untitled')
    // The foreman's id is the same in every workspace: its tabs are kept per workspace.
    const workspaceId = useSession().workspace?.id ?? 'none'
    const { tabs, activeIndex, selectTab, closeTab, openTab } = useSessionTabs(`${FOREMAN_AGENT_ID}:${workspaceId}`)

    // The store keeps a single draft: a "New conversation" left before anything was written in it has nothing
    // to reopen, so its tab goes with it.
    const blankDraftOnScreen = useRef<string | null>(null)
    useEffect(() => {
        const leftDraft = blankDraftOnScreen.current
        if (leftDraft && leftDraft !== sessionId) {
            const index = tabs.findIndex(tab => !isGeneralTab(tab) && tab.id === leftDraft)
            if (index !== -1) closeTab(index)
        }
        if (inThread) openTab(sessionId, untitled)
        else selectTab(0)
    }, [inThread, sessionId, untitled, tabs, openTab, selectTab, closeTab])
    useEffect(() => {
        blankDraftOnScreen.current = inThread && blankDraft ? sessionId : null
    }, [inThread, blankDraft, sessionId])

    const rowById = useMemo(() => new Map(threads.map(row => [row.id, row])), [threads])
    const shownTabs = useMemo(() => tabs.map(tab => (isGeneralTab(tab) ? { ...tab, title: generalTitle } : { ...tab, title: (tab.id && rowById.get(tab.id)?.title) || tab.title })), [tabs, rowById, generalTitle])

    const show = (index: number) => {
        const id = tabs[index]?.id
        if (index === 0 || !id) onShowGeneral()
        else onOpenThread(id)
    }

    const close = (index: number) => {
        if (isGeneralTab(tabs[index])) return
        if (index === activeIndex) {
            const rest = tabs.filter((_, i) => i !== index)
            const next = rest[Math.min(index, rest.length - 1)]
            if (!next?.id || isGeneralTab(next)) onShowGeneral()
            else onOpenThread(next.id)
        }
        closeTab(index)
    }

    return (
        <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-2">
            {start}
            <div className="min-w-0 flex-1">
                <OpenChatsTabs tabs={shownTabs} activeIndex={activeIndex} onSelect={show} onClose={close} onCreate={onNewTask} statusOf={tab => (tab.id ? rowById.get(tab.id)?.status : undefined)} />
            </div>
            {history}
        </div>
    )
}
