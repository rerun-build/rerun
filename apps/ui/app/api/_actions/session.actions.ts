'use server'

import { assertAgentAccess, assertSessionInWorkspace } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { clearSessionAlert, findGeneralSession, findIdleSessions, findSessionActiveRun, type GeneralSession } from '@/app/api/_services/chat.service'
import { adoptEngineSession, cancelSessionRuns, EMPTY_SESSION_SNAPSHOT, finalizeSession, listAgentSessions, listAgentThreads, readSessionMessages, readSessionSnapshot, searchWorkspaceConversations, type ConversationHit, type SessionHistoryEntry, type SessionSnapshot, type ThreadRow } from '@/app/api/_services/conversation.service'

export async function finalizeSessionAction(sessionId: string, status: 'idle' | 'error', options?: { onlyWhileWorking?: boolean }): Promise<void> {
    await finalizeSession(sessionId, status, options).catch(() => {})
}

export async function acknowledgeSessionAlertAction(sessionId: string): Promise<void> {
    await assertSessionInWorkspace(sessionId)
    await clearSessionAlert(sessionId)
}

export async function listAgentSessionsAction(agentId: string): Promise<SessionHistoryEntry[]> {
    return listAgentSessions(agentId).catch(() => [])
}

export async function listAgentThreadsAction(agentId: string): Promise<ThreadRow[]> {
    return listAgentThreads(agentId).catch(() => [])
}

export async function getGeneralSessionAction(agentId: string): Promise<GeneralSession | null> {
    await assertAgentAccess(agentId, 'use')
    return findGeneralSession(agentId).catch(() => null)
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

export async function fetchSessionMessages(sessionId: string) {
    return readSessionMessages(sessionId).catch(() => [])
}

export async function openSessionAction(sessionId: string): Promise<SessionSnapshot> {
    return readSessionSnapshot(sessionId).catch(() => EMPTY_SESSION_SNAPSHOT)
}

export async function findIdleSessionsAction(sessionIds: string[]): Promise<string[]> {
    return findIdleSessions(sessionIds).catch(() => [])
}

export async function fetchSessionActiveRun(sessionId: string): Promise<string | null> {
    return findSessionActiveRun(sessionId)
}

export async function cancelSessionRunsAction(sessionId: string): Promise<boolean> {
    return cancelSessionRuns(sessionId)
        .then(() => true)
        .catch(() => false)
}
