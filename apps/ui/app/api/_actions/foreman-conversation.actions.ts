'use server'

import type { Conversation } from '@rerun/contracts'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { pendingRequestPeek, type PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { listForemanConversations, readForemanEngineMessages } from '@/lib/foreman/conversation'

/** General and its threads, for the column: the same list the app reads from /api/v1/foreman/conversations. */
export async function listForemanConversationsAction(): Promise<Conversation[]> {
    try {
        return await listForemanConversations(await requireWorkspaceContext())
    } catch {
        return []
    }
}

/** What a conversation of the Chief of Staff waits on, read the way `peekPendingRequestAction` reads a coworker's. */
export async function peekForemanPendingRequestAction(sessionId: string): Promise<PendingRequestPeek | null> {
    try {
        const messages = await readForemanEngineMessages(await requireWorkspaceContext(), sessionId)
        return messages.length ? pendingRequestPeek(messages) : null
    } catch {
        return null
    }
}
