'use server'

import type { Conversation } from '@rerun/contracts'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { listForemanConversations, markForemanConversationRead } from '@/lib/foreman/conversation'

/** General and its threads, for the column: the same list the app reads from /api/v1/foreman/conversations. */
export async function listForemanConversationsAction(): Promise<Conversation[]> {
    try {
        return await listForemanConversations(await requireWorkspaceContext())
    } catch {
        return []
    }
}

/** « Mark as read » on a conversation of the Chief of Staff waiting on the caller: back to idle. */
export async function markForemanConversationReadAction(sessionId: string): Promise<void> {
    await markForemanConversationRead(await requireWorkspaceContext(), sessionId)
}
