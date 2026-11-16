'use client'

import { useCallback, useEffect, useState } from 'react'

import { peekPendingRequestAction } from '@/app/api/_actions/session.actions'
import { useAgentModel } from '@/hooks/useAgentModel'
import type { PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { sendSessionMessage } from '@/lib/chat/send-session-message'
import { resolveSessionId } from '@/lib/notifications/open-conversation'

export type InboxPeek = { state: 'loading' } | { state: 'unreadable' } | { state: 'ready'; sessionId: string; peek: PendingRequestPeek }

export type PeekAnswerOutcome = 'sent' | 'busy' | 'stale' | 'failed'

/** The conversation an inbox entry stands for: a row knows its session, an announcement only the engine's id. */
export type InboxPeekTarget = { agentId: string; sessionId: string | null; engineSessionId: string | null }

// Reads what a conversation waits on and answers it from the inbox, the way its chat would.
export function useInboxPeek({ agentId, sessionId, engineSessionId }: InboxPeekTarget) {
    const [peek, setPeek] = useState<InboxPeek>({ state: 'loading' })
    const { selection: model } = useAgentModel(agentId)

    useEffect(() => {
        let cancelled = false
        const load = async (): Promise<InboxPeek> => {
            const resolved = sessionId ?? (engineSessionId ? await resolveSessionId(agentId, engineSessionId) : null)
            if (!resolved) return { state: 'unreadable' }
            const read = await peekPendingRequestAction(resolved)
            return read ? { state: 'ready', sessionId: resolved, peek: read } : { state: 'unreadable' }
        }
        load()
            .catch((): InboxPeek => ({ state: 'unreadable' }))
            .then(next => {
                if (!cancelled) setPeek(next)
            })
        return () => {
            cancelled = true
        }
    }, [agentId, sessionId, engineSessionId])

    // The card may have stayed open while the question was answered elsewhere: the chat, another tab, a
    // teammate. Read again right before sending, so an answer never lands on a request that is gone.
    const answer = useCallback(
        async (text: string): Promise<PeekAnswerOutcome> => {
            if (peek.state !== 'ready' || !peek.peek.pending) return 'stale'
            const fresh = await peekPendingRequestAction(peek.sessionId)
            if (fresh?.pending?.toolCallId !== peek.peek.pending.toolCallId) return 'stale'
            return sendSessionMessage({ agentId, sessionId: peek.sessionId, text, model })
        },
        [agentId, model, peek]
    )

    return { peek, answer }
}
