'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { useCallback, useEffect, useState } from 'react'

import { peekForemanPendingRequestAction } from '@/app/api/_actions/foreman-conversation.actions'
import { peekPendingRequestAction } from '@/app/api/_actions/session.actions'
import { useAgentModel } from '@/hooks/useAgentModel'
import type { PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { sendForemanThreadMessage, sendSessionMessage } from '@/lib/chat/send-session-message'
import { resolveSessionId } from '@/lib/notifications/open-conversation'
import { useForemanStore } from '@/stores/foreman.store'

export type InboxPeek = { state: 'loading' } | { state: 'unreadable' } | { state: 'ready'; sessionId: string; peek: PendingRequestPeek }

export type PeekAnswerOutcome = 'sent' | 'busy' | 'stale' | 'failed'

/** The conversation an inbox entry stands for: a row knows its session, an announcement only the engine's id. */
export type InboxPeekTarget = { agentId: string; sessionId: string | null; engineSessionId: string | null }

// The Chief of Staff's conversations are read and answered through its own route, whichever id names
// it: the literal `foreman` of the lists, or its row of `agents` in its chat.
function readPendingRequest(isForeman: boolean, sessionId: string): Promise<PendingRequestPeek | null> {
    return isForeman ? peekForemanPendingRequestAction(sessionId) : peekPendingRequestAction(sessionId)
}

// Reads what a conversation waits on and answers it from the inbox, the way its chat would. Held off
// while `enabled` is false, and read again each time it turns true or `revision` changes: a thread of
// General asks again, and its status alone may have gone there and back between two reads of the list.
export function useInboxPeek({ agentId, sessionId, engineSessionId }: InboxPeekTarget, enabled = true, revision?: string) {
    const [peek, setPeek] = useState<InboxPeek>({ state: 'loading' })
    const foremanRowId = useForemanStore(state => state.agentRowId)
    const isForeman = agentId === FOREMAN_AGENT_ID || (foremanRowId !== null && agentId === foremanRowId)
    const { selection: model } = useAgentModel(isForeman ? (foremanRowId ?? FOREMAN_AGENT_ID) : agentId)

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        const load = async (): Promise<InboxPeek> => {
            const resolved = sessionId ?? (engineSessionId ? await resolveSessionId(agentId, engineSessionId) : null)
            if (!resolved) return { state: 'unreadable' }
            const read = await readPendingRequest(isForeman, resolved)
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
    }, [agentId, isForeman, sessionId, engineSessionId, enabled, revision])

    // The card may have stayed open while the question was answered elsewhere: the chat, another tab, a
    // teammate. Read again right before sending, so an answer never lands on a request that is gone.
    const answer = useCallback(
        async (text: string): Promise<PeekAnswerOutcome> => {
            if (peek.state !== 'ready' || !peek.peek.pending) return 'stale'
            const fresh = await readPendingRequest(isForeman, peek.sessionId)
            if (fresh?.pending?.toolCallId !== peek.peek.pending.toolCallId) return 'stale'
            if (isForeman) return sendForemanThreadMessage({ sessionId: peek.sessionId, text, model })
            return sendSessionMessage({ agentId, sessionId: peek.sessionId, text, model })
        },
        [agentId, isForeman, model, peek]
    )

    return { peek, answer }
}
