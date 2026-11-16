'use client'

import { ATTENTION_STATUSES, FOREMAN_AGENT_ID, type Conversation } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { listForemanConversationsAction } from '@/app/api/_actions/foreman-conversation.actions'
import type { AttentionSession } from '@/hooks/useAttentionSessions'
import { createClient } from '@/supabase/client'
import { useSession } from '@/supabase/session/SessionProvider'
import { selectMany } from '@/supabase/supabase-helpers'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

const REFRESH_DEBOUNCE_MS = 500
const attention: ReadonlySet<string> = new Set(ATTENTION_STATUSES)

// What the Chief of Staff left for the caller, by conversation: the newest of its notifications, which
// only their recipient can read.
async function lastMessages(engineSessionIds: string[]): Promise<Map<string, string>> {
    if (!engineSessionIds.length) return new Map()
    const { data } = await selectMany(createClient(), 'notifications', ['engine_session_id', 'message'] as const, { engine_agent_id: FOREMAN_AGENT_ID, engine_session_id: engineSessionIds }, { column: 'created_at', ascending: false })
    const byId = new Map<string, string>()
    for (const row of data ?? []) if (row.engine_session_id && !byId.has(row.engine_session_id)) byId.set(row.engine_session_id, row.message)
    return byId
}

/**
 * The conversations of the Chief of Staff waiting on the caller, for the « To handle » list: what a
 * wake proposed, asked, or said. Its own channel, beside the column's, since the inbox lives without it.
 */
export function useForemanAttention(enabled: boolean): AttentionSession[] {
    const { user } = useSession()
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [messages, setMessages] = useState<Map<string, string>>(new Map())
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const load = useCallback(() => {
        void listForemanConversationsAction()
            .then(async rows => {
                const waiting = rows.filter(row => attention.has(row.status) && row.id)
                setConversations(waiting)
                setMessages(await lastMessages(waiting.map(row => row.engineSessionId)))
            })
            .catch(() => {})
    }, [])

    const refresh = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            timer.current = null
            load()
        }, REFRESH_DEBOUNCE_MS)
    }, [load])

    useEffect(() => {
        if (!enabled) return
        load()
        return () => {
            if (timer.current) clearTimeout(timer.current)
        }
    }, [enabled, load])

    useRealtimeSubscription('foreman_conversations', {
        channelId: `foreman-attention-${user?.id ?? 'none'}`,
        enabled: enabled && !!user?.id,
        filter: { column: 'user_id', value: user?.id ?? '' },
        onInsert: refresh,
        onUpdate: refresh,
        onResync: refresh,
    })

    return useMemo(
        () =>
            conversations.map(row => ({
                id: row.id as string,
                agentId: FOREMAN_AGENT_ID,
                engineSessionId: row.engineSessionId,
                status: row.status,
                title: row.title,
                message: messages.get(row.engineSessionId) ?? null,
                updatedAt: row.updatedAt,
                reason: 'mine' as const,
            })),
        [conversations, messages]
    )
}
