'use client'

import { useCallback, useEffect, useRef } from 'react'

import { historyCovers, userTurns } from '@/lib/chat/transcript-reconcile'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'

type MessageLike = Parameters<typeof historyCovers>[0][number]

type CatchUpSource<M extends MessageLike> = {
    // False while this tab sends or streams: its own run is already on screen.
    idle: boolean
    messages: readonly M[]
    // Bound to the conversation on screen: a new identity marks another conversation.
    fetchMessages: () => Promise<unknown[]>
    setMessages: (messages: M[]) => void
    // The row a run updates when it starts and ends in that conversation.
    row: { table: 'sessions' | 'foreman_conversations'; id: string | null | undefined; channelId: string; enabled: boolean }
}

/**
 * A run this tab did not start can end in the conversation on screen: a message sent from another
 * device, or the end of a job on a linked computer that wakes the coworker. Its start and end update
 * the conversation's row; this reads the transcript back then, and again when the tab comes back to
 * the foreground or online, since a hidden tab loses the updates sent while its socket was down. It
 * shows what was added when the tab is idle and the transcript holds everything already on screen
 * and a turn more.
 */
export function useTranscriptCatchUp<M extends MessageLike>(source: CatchUpSource<M>): void {
    const live = useRef(source)
    useEffect(() => {
        live.current = source
    })

    const readTranscript = useCallback(async () => {
        const { idle, fetchMessages } = live.current
        if (!idle) return
        const fetched = (await fetchMessages().catch(() => null)) as M[] | null
        const now = live.current
        if (!fetched || !now.idle || now.fetchMessages !== fetchMessages) return
        if (!historyCovers(now.messages, fetched)) return
        // Counted in turns, not messages: the live chat splits an answer into messages its own way.
        const added = userTurns(fetched) > userTurns(now.messages) || (now.messages.at(-1)?.role === 'user' && fetched.at(-1)?.role === 'assistant')
        if (added) now.setMessages(fetched)
    }, [])

    // One read at a time. The read in flight may have left before the row changed, so a change is
    // read again after it; a resync adds nothing to it, it left when the tab came back.
    const reading = useRef(false)
    const changedWhileReading = useRef(false)
    const catchUp = useCallback(
        async (rowChanged: boolean) => {
            if (reading.current) {
                changedWhileReading.current ||= rowChanged
                return
            }
            reading.current = true
            try {
                do {
                    changedWhileReading.current = false
                    await readTranscript()
                } while (changedWhileReading.current)
            } finally {
                reading.current = false
            }
        },
        [readTranscript]
    )

    const { table, id, channelId, enabled } = source.row
    // The conversation was read when it opened, so the first join of its channel brings nothing new.
    // Joining it again, once the chat comes back on screen, does: nothing listened in between.
    const joinedFor = useRef<string | null>(null)
    useRealtimeSubscription(table, {
        channelId,
        enabled: enabled && !!id,
        filter: { column: 'id', value: id ?? '' },
        onUpdate: () => void catchUp(true),
        onResync: () => {
            if (joinedFor.current !== id) {
                joinedFor.current = id ?? null
                return
            }
            void catchUp(false)
        },
    })
}
