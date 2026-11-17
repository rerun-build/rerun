'use client'

import { useCallback, useEffect, useRef } from 'react'

import { historyCovers, userTurns } from '@/lib/chat/transcript-reconcile'

type MessageLike = Parameters<typeof historyCovers>[0][number]

type CatchUpSource<M extends MessageLike> = {
    // False while this tab sends or streams: its own run is already on screen.
    idle: boolean
    messages: readonly M[]
    // Bound to the conversation on screen: a new identity marks another conversation.
    fetchMessages: () => Promise<unknown[]>
    setMessages: (messages: M[]) => void
}

/**
 * A run this tab did not start can end in the conversation on screen: the end of a job on a linked
 * computer wakes the coworker there. Its end updates the conversation's row; called then, this reads
 * the transcript back and shows what that run added, when the tab is idle and the transcript holds
 * everything already on screen and a turn more.
 */
export function useTranscriptCatchUp<M extends MessageLike>(source: CatchUpSource<M>): () => Promise<void> {
    const live = useRef(source)
    useEffect(() => {
        live.current = source
    })

    return useCallback(async () => {
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
}
