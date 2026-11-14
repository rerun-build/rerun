import { foremanEngineConversationSchema, foremanEngineFilesSchema, foremanEngineMessagesSchema, foremanStateSchema, type ConversationMessage, type ForemanStateResponse, type ForemanSurface } from '@rerun/contracts'

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

export async function fetchForemanConversation(caller: Caller): Promise<ForemanConversation | null> {
    return foremanEngineConversationSchema.parse(await api(ENGINE, caller))
}

export async function fetchForemanMessages(caller: Caller, sessionId: string): Promise<ConversationMessage[]> {
    return foremanEngineMessagesSchema.parse(await api(`${ENGINE}?sessionId=${encodeURIComponent(sessionId)}`, caller)).messages
}

export async function fetchForemanActiveRun(caller: Caller, sessionId: string): Promise<string | null> {
    const conversation = await fetchForemanConversation(caller)
    return conversation?.sessionId === sessionId ? (conversation.activeRunId ?? null) : null
}

export async function stopForeman(caller: Caller, sessionId: string, runId: string | null): Promise<void> {
    const params = new URLSearchParams({ sessionId, ...(runId ? { runId } : {}) })
    await api(`${ENGINE}?${params}`, { ...caller, method: 'DELETE' })
}
