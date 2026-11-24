'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { ThreadRow } from '@/app/api/_services/conversation.service'
import { useOpenChatsSync } from '@/hooks/useOpenChatsSync'
import { isGeneralTab, useSessionTabs } from '@/hooks/useSessionTabs'
import { useSession } from '@/supabase/session/SessionProvider'

type ForemanTabsOptions = {
    /** The conversation on screen: General's id, or one of its threads. */
    sessionId: string
    inThread: boolean
    /** The "New conversation" last opened, until it is left: it has an id before the hub writes it down. */
    draftId: string | null
    /** The thread on screen is a "New conversation" nobody has written in yet. */
    blankDraft: boolean
    /** Moves on each time a thread is asked for, the one on screen included. */
    threadOpenRequest: number
    threads: ThreadRow[]
    untitled: string
    /** The engine's Chief of Staff, its chat in front of the person. */
    onScreen: boolean
    onShowGeneral: () => void
    onOpenThread: (id: string) => void
}

/**
 * The Chief of Staff's open conversations, wherever its column is: General, then the threads opened
 * here, kept across reloads and devices. The store says which conversation is on screen; the tabs
 * follow it, whoever opened it (+, the history, a notification).
 */
export function useForemanTabs({ sessionId, inThread, draftId, blankDraft, threadOpenRequest, threads, untitled, onScreen, onShowGeneral, onOpenThread }: ForemanTabsOptions) {
    // The foreman's id is the same in every workspace: its tabs are kept per workspace.
    const workspaceId = useSession().workspace?.id ?? 'none'
    const storageKey = `${FOREMAN_AGENT_ID}:${workspaceId}`
    const sessionTabs = useSessionTabs(storageKey, { opensOnGeneral: true })
    const { tabs, activeIndex, selectTab, closeTab, openTab, updateTabTitle } = sessionTabs

    // The store keeps a single draft: a "New conversation" left before anything was written in it has nothing
    // to reopen, so its tab goes with it.
    const blankDraftOnScreen = useRef<string | null>(null)
    useEffect(() => {
        const leftDraft = blankDraftOnScreen.current
        if (leftDraft && leftDraft !== sessionId) {
            const index = tabs.findIndex(tab => !isGeneralTab(tab) && tab.id === leftDraft)
            if (index !== -1) closeTab(index)
        }
        if (inThread) openTab(sessionId, untitled, { draft: blankDraft })
        else selectTab(0)
    }, [inThread, sessionId, untitled, blankDraft, tabs, openTab, selectTab, closeTab])
    useEffect(() => {
        blankDraftOnScreen.current = inThread && blankDraft ? sessionId : null
    }, [inThread, blankDraft, sessionId])

    const rowById = useMemo(() => new Map(threads.map(row => [row.id, row])), [threads])
    // Never read from the list alone: it arrives after the tabs, and holds only the latest threads.
    const syncable = useCallback((id: string) => id !== draftId || rowById.has(id), [draftId, rowById])
    const { resume, dismiss, stay, pickGeneral } = useOpenChatsSync({ agentId: FOREMAN_AGENT_ID, storageKey, tabs: sessionTabs, onScreen, syncable, generalPickedByTab: false, onShowGeneral })

    useEffect(() => {
        if (threadOpenRequest > 0) stay()
    }, [threadOpenRequest, stay])

    const showGeneral = useCallback(() => {
        pickGeneral()
        onShowGeneral()
    }, [pickGeneral, onShowGeneral])

    const show = useCallback(
        (index: number) => {
            const id = tabs[index]?.id
            if (index === 0 || !id) showGeneral()
            else onOpenThread(id)
        },
        [tabs, showGeneral, onOpenThread]
    )

    const close = useCallback(
        (index: number) => {
            if (isGeneralTab(tabs[index])) return
            if (index === activeIndex) {
                const rest = tabs.filter((_, i) => i !== index)
                const next = rest[Math.min(index, rest.length - 1)]
                if (!next?.id || isGeneralTab(next)) showGeneral()
                else onOpenThread(next.id)
            }
            closeTab(index)
        },
        [tabs, activeIndex, showGeneral, onOpenThread, closeTab]
    )

    return { tabs, activeIndex, rowById, show, close, showGeneral, updateTabTitle, resume, dismissResume: dismiss }
}

export type ForemanTabs = ReturnType<typeof useForemanTabs>
