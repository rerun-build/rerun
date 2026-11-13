'use client'

import { useEffect, useRef, useState } from 'react'

import type { ChatsFilter } from '@/components/agent/sheet/AgentChatsList'
import { isAgentViewTab, type AgentViewTab } from '@/lib/board/agent-sheet-views'
import { useBoardStore } from '@/stores/board.store'

// What a link asked the frame around the coworker to show: one of its screens, the list of its
// conversations, or its thread.
export type AgentSheetRequest = { kind: 'screen' } | { kind: 'chats'; filter: ChatsFilter } | { kind: 'thread' }

/**
 * Which screen of the selected coworker is on show (Apps, Files, Settings…), null for none. A file or
 * a table link, and the focus requests of notifications, search or emails, open theirs; another
 * coworker opens on none. The 3D panel and the Simple view frame it differently, so what is not a
 * screen is handed to `onRequest`.
 */
export function useAgentSheetView(onRequest: (request: AgentSheetRequest) => void) {
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const agentFocusRequest = useBoardStore(s => s.agentFocusRequest)
    const clearAgentFocus = useBoardStore(s => s.clearAgentFocus)
    const agentFileFocus = useBoardStore(s => s.agentFileFocus)
    const agentDataFocus = useBoardStore(s => s.agentDataFocus)
    const [viewTab, setViewTab] = useState<AgentViewTab | null>(null)
    const onRequestRef = useRef(onRequest)
    useEffect(() => {
        onRequestRef.current = onRequest
    })

    // A file or table link opens its screen on the very render that carries it, before the screen
    // reads and clears it. The two signals are mutually exclusive in the store.
    const displayedTab: AgentViewTab | null = agentFileFocus?.agentId === selectedAgentId ? 'files' : agentDataFocus?.agentId === selectedAgentId ? 'data' : viewTab

    // Another coworker opens on its thread, never on the screen the previous one was showing.
    useEffect(() => {
        setViewTab(null)
    }, [selectedAgentId])

    // A file or table link keeps its screen once the screen has consumed the link.
    useEffect(() => {
        if (agentFileFocus?.agentId === selectedAgentId) setViewTab('files')
        else if (agentDataFocus?.agentId === selectedAgentId) setViewTab('data')
        else return
        onRequestRef.current({ kind: 'screen' })
    }, [agentFileFocus, agentDataFocus, selectedAgentId])

    // External surfaces can open an agent on a precise tab without owning the frame's local state.
    useEffect(() => {
        if (!agentFocusRequest) return
        const tab = agentFocusRequest.tab
        if (isAgentViewTab(tab)) {
            setViewTab(tab)
            onRequestRef.current({ kind: 'screen' })
        } else {
            setViewTab(null)
            onRequestRef.current(tab === 'actions' ? { kind: 'chats', filter: 'needs' } : { kind: 'thread' })
        }
        clearAgentFocus()
    }, [agentFocusRequest, clearAgentFocus])

    return { viewTab, setViewTab, displayedTab }
}
