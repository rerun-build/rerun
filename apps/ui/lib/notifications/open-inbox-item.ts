'use client'

import type { InboxItem } from '@/hooks/useInboxItems'
import { useBoardStore } from '@/stores/board.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'

// Opens the conversation an inbox row stands for, on the coworker's chat. The conversation opened marks
// itself read; the other runs of the same task go with it.
export function openInboxItem(item: Pick<InboxItem, 'id' | 'agentId' | 'latestSessionId' | 'sessionIds'>): void {
    const board = useBoardStore.getState()
    board.focusAgentOnBoard(item.agentId, 'chat')
    board.setPendingOpenSession({ agentId: item.agentId, sessionId: item.latestSessionId ?? item.id, runId: null })
    if (item.sessionIds) void useUnseenRunsStore.getState().markSeen(item.sessionIds)
}
