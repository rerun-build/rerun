import { conversationSchema, foremanEngineConversationSchema, foremanEngineFilesSchema, foremanEngineMessagesSchema, foremanStateSchema, type Conversation, type ConversationMessage, type ForemanStateResponse, type ForemanSurface } from '@rerun/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

const ENGINE = '/api/chat/foreman/engine'

export type ForemanConversation = NonNullable<ReturnType<typeof foremanEngineConversationSchema.parse>>

export async function fetchForemanState(caller: Caller): Promise<ForemanStateResponse> {
    return foremanStateSchema.parse(await api('/api/chat/foreman/state', caller))
}

export async function fetchForemanSurface(caller: Caller): Promise<ForemanSurface> {
    return (await fetchForemanState(caller)).surface
}

export async function fetchForemanEngineFiles(caller: Caller): Promise<boolean> {
    return foremanEngineFilesSchema.parse(await api('/api/v1/foreman/files', caller)).supported
}

// General, the conversation the Foreman's page opens on: null before anyone spoke in it.
export async function fetchForemanConversation(caller: Caller): Promise<ForemanConversation | null> {
    return foremanEngineConversationSchema.parse(await api(ENGINE, caller))
}

export async function fetchForemanMessages(caller: Caller, sessionId: string): Promise<ConversationMessage[]> {
    return foremanEngineMessagesSchema.parse(await api(`${ENGINE}?sessionId=${encodeURIComponent(sessionId)}`, caller)).messages
}

// General and its threads, newest first, in the shape a coworker's conversations have.
export async function fetchForemanConversations(caller: Caller): Promise<Conversation[]> {
    return conversationSchema.array().parse(await api('/api/v1/foreman/conversations', caller))
}

// A hub older than threads only says which run its last conversation has going, and answers the
// others with their transcript alone.
export async function fetchForemanActiveRun(caller: Caller, sessionId: string): Promise<string | null> {
    const conversation = foremanEngineConversationSchema.parse(await api(`${ENGINE}?sessionId=${encodeURIComponent(sessionId)}`, caller))
    return conversation?.activeRunId ?? null
}

export async function stopForeman(caller: Caller, sessionId: string, runId: string | null): Promise<void> {
    const params = new URLSearchParams({ sessionId, ...(runId ? { runId } : {}) })
    await api(`${ENGINE}?${params}`, { ...caller, method: 'DELETE' })
}
