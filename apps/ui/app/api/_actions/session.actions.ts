'use server'

import { assertSessionInWorkspace } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { clearSessionAlert, findIdleSessions, findSessionActiveRun } from '@/app/api/_services/chat.service'
import { sessionHistoryFilterSchema, type SessionHistoryFilter } from '@/lib/chat/history-filter'
import type { PendingRequestPeek } from '@/lib/chat/pending-request-peek'
import { adoptEngineSession, cancelSessionRuns, finalizeSession, listAgentSessions, listAgentThreads, readPendingRequest, readSessionMessages, renameSession, searchWorkspaceConversations, type ConversationHit, type SessionHistoryEntry, type ThreadRow } from '@/app/api/_services/conversation.service'

export async function finalizeSessionAction(sessionId: string, status: 'idle' | 'error', options?: { onlyWhileWorking?: boolean }): Promise<void> {
    await finalizeSession(sessionId, status, options).catch(() => {})
}

export async function acknowledgeSessionAlertAction(sessionId: string): Promise<void> {
    await assertSessionInWorkspace(sessionId)
    await clearSessionAlert(sessionId)
}

export async function listAgentSessionsAction(agentId: string, filter: SessionHistoryFilter = 'all'): Promise<SessionHistoryEntry[]> {
    return listAgentSessions(agentId, undefined, sessionHistoryFilterSchema.parse(filter)).catch(() => [])
}

export async function listAgentThreadsAction(agentId: string): Promise<ThreadRow[]> {
    return listAgentThreads(agentId).catch(() => [])
}

export async function searchConversationsAction(query: string, agentId?: string): Promise<ConversationHit[]> {
    try {
        return await searchWorkspaceConversations(await requireWorkspaceContext(), query, agentId)
    } catch {
        return []
    }
}

export async function adoptEngineSessionAction(agentId: string, engineSessionId: string, title: string): Promise<string> {
    return adoptEngineSession(agentId, engineSessionId, title)
}

export async function renameSessionAction(sessionId: string, title: string): Promise<boolean> {
    return renameSession(sessionId, title).catch(() => false)
}

export async function fetchSessionMessages(sessionId: string) {
    return readSessionMessages(sessionId).catch(() => [])
}

// Null when the conversation cannot be read: the inbox then only offers to open it.
export async function peekPendingRequestAction(sessionId: string): Promise<PendingRequestPeek | null> {
    return readPendingRequest(sessionId).catch(() => null)
}

// Sessions among these the engine confirms are no longer running, for the board's zombie sweep.
export async function findIdleSessionsAction(sessionIds: string[]): Promise<string[]> {
    return findIdleSessions(sessionIds).catch(() => [])
}

// Run currently in flight on a session, so a conversation opened from the history can attach to
// its stream instead of watching a loader spin. The engine is the only source of truth here: a
// run started by a schedule or a trigger has no run id anywhere in Supabase.
export async function fetchSessionActiveRun(sessionId: string): Promise<string | null> {
    return findSessionActiveRun(sessionId)
}

export async function cancelSessionRunsAction(sessionId: string): Promise<boolean> {
    return cancelSessionRuns(sessionId)
        .then(() => true)
        .catch(() => false)
}
