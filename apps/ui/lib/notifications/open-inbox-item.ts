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

// A finished run is marked seen with the other runs of its task; a request is put aside, as « Mark as read » of the inbox does.
export function markInboxItemRead(item: Pick<InboxItem, 'id' | 'sessionIds'>): void {
    if (item.sessionIds) void useUnseenRunsStore.getState().markSeen(item.sessionIds)
    else useBoardStore.getState().setSessionStatus(item.id, 'idle')
}
