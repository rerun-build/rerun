'use server'

import type { Conversation } from '@rerun/contracts'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { listForemanConversations } from '@/lib/foreman/conversation'

/** General and its threads, for the column: the same list the app reads from /api/v1/foreman/conversations. */
export async function listForemanConversationsAction(): Promise<Conversation[]> {
    try {
        return await listForemanConversations(await requireWorkspaceContext())
    } catch {
        return []
    }
}
