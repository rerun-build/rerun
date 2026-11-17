'use client'

import type { Conversation, SessionStatus } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { listForemanConversationsAction } from '@/app/api/_actions/foreman-conversation.actions'
import type { SessionHistoryEntry, ThreadRow } from '@/app/api/_services/conversation.service'
import { useSession } from '@/supabase/session/SessionProvider'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

// A run that ends writes its status, then its title: one read covers both.
const REFRESH_DEBOUNCE_MS = 500

type Thread = Conversation & { id: string }

const isThread = (conversation: Conversation): conversation is Thread => conversation.kind === 'thread' && !!conversation.id

// A thread drawn with the parts of a coworker's: nobody else opens a conversation of the foreman, and
// none of them is a routine's run.
function threadRowOf(conversation: Thread): ThreadRow {
    return {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        source: conversation.source,
        createdAt: conversation.createdAt ?? conversation.updatedAt,
        updatedAt: conversation.updatedAt,
        originAgentId: null,
        automationName: null,
        outcome: null,
        firstMessage: conversation.firstMessage ?? null,
    }
}

// The same row as a coworker's list of conversations draws.
export function historyEntryOf(conversation: Thread): SessionHistoryEntry {
    return { ...threadRowOf(conversation), agentId: conversation.agentId, engineSessionId: conversation.engineSessionId, originAgentName: null, kind: conversation.kind ?? 'thread' }
}

/**
 * General's threads, the newest first: as branches of General (`threads`) and as rows of the list of
 * every conversation (`entries`). Read when the column needs them, then again, debounced, on
 * every change of this person's conversations: a thread that opens, starts working, waits on an
 * answer or gets its title. Only the engine's foreman has threads.
 */
export type ForemanThreads = {
    threads: ThreadRow[]
    entries: SessionHistoryEntry[]
    // This person's General, once they have spoken in it.
    general: Conversation | null
    // Where each of their conversations stands, General included, as the server last said.
    statusOf: (sessionId: string) => SessionStatus | null
    // The first read has answered: no General then means none yet.
    loaded: boolean
}

export function useForemanThreads(enabled: boolean): ForemanThreads {
    const { user } = useSession()
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loaded, setLoaded] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // A read the network drops is taken again at the next realtime event or resync; the rows in
    // hand stay until then.
    const refresh = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            timer.current = null
            void listForemanConversationsAction()
                .then(setConversations)
                .catch(() => {})
        }, REFRESH_DEBOUNCE_MS)
    }, [])

    useEffect(() => {
        if (!enabled) return
        let alive = true
        listForemanConversationsAction()
            .then(rows => {
                if (!alive) return
                setConversations(rows)
                setLoaded(true)
            })
            .catch(() => {})
        return () => {
            alive = false
            if (timer.current) clearTimeout(timer.current)
        }
    }, [enabled])

    // Only this person's conversations with the Chief of Staff carry their id as owner.
    useRealtimeSubscription('sessions', {
        channelId: `foreman-conversations-${user?.id ?? 'none'}`,
        enabled: enabled && !!user?.id,
        filter: { column: 'owner_id', value: user?.id ?? '' },
        onInsert: refresh,
        onUpdate: refresh,
        onResync: refresh,
    })

    return useMemo(() => {
        const threads = conversations.filter(isThread)
        const statuses = new Map(conversations.map(conversation => [conversation.id, conversation.status]))
        return {
            threads: threads.map(threadRowOf),
            entries: threads.map(historyEntryOf),
            general: conversations.find(conversation => conversation.kind === 'general') ?? null,
            statusOf: (sessionId: string) => statuses.get(sessionId) ?? null,
            loaded,
        }
    }, [conversations, loaded])
}
