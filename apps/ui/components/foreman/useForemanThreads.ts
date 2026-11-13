'use client'

import type { Conversation } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { listForemanConversationsAction } from '@/app/api/_actions/foreman-conversation.actions'
import type { ThreadRow } from '@/app/api/_services/conversation.service'
import { useSession } from '@/supabase/session/SessionProvider'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

// A run that ends writes its status, then its title: one read covers both.
const REFRESH_DEBOUNCE_MS = 500

// A thread drawn with the parts of a coworker's: nobody else opens a conversation of the foreman, and
// none of them is a routine's run.
function threadRowOf(conversation: Conversation & { id: string }): ThreadRow {
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

/**
 * General's threads, the newest first. Read when the column needs them, then again, debounced, on
 * every change of this person's conversations: a thread that opens, starts working, waits on an
 * answer or gets its title. Only the engine's foreman has threads.
 */
export function useForemanThreads(enabled: boolean): ThreadRow[] {
    const { user } = useSession()
    const [conversations, setConversations] = useState<Conversation[]>([])
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
            .then(rows => alive && setConversations(rows))
            .catch(() => {})
        return () => {
            alive = false
            if (timer.current) clearTimeout(timer.current)
        }
    }, [enabled])

    useRealtimeSubscription('foreman_conversations', {
        channelId: `foreman-conversations-${user?.id ?? 'none'}`,
        enabled: enabled && !!user?.id,
        filter: { column: 'user_id', value: user?.id ?? '' },
        onInsert: refresh,
        onUpdate: refresh,
        onResync: refresh,
    })

    return useMemo(() => conversations.filter((conversation): conversation is Conversation & { id: string } => conversation.kind === 'thread' && !!conversation.id).map(threadRowOf), [conversations])
}
