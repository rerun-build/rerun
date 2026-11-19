import { foremanEngineConversationSchema, mobileApi, type Conversation, type ConversationMessage, type ForemanStateResponse } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export type ForemanConversation = NonNullable<ReturnType<typeof foremanEngineConversationSchema.parse>>

export async function fetchForemanState(caller: Caller): Promise<ForemanStateResponse> {
    return hub(mobileApi.getForemanState, caller)
}

export async function fetchForemanEngineFiles(caller: Caller): Promise<boolean> {
    return (await hub(mobileApi.getForemanEngineFiles, caller)).supported
}

// General, the conversation the Foreman's page opens on: null before anyone spoke in it.
export async function fetchForemanConversation(caller: Caller): Promise<ForemanConversation | null> {
    const reply = await hub(mobileApi.getForemanConversation, { ...caller, query: {} })
    return reply && 'sessionId' in reply ? reply : null
}

export async function fetchForemanMessages(caller: Caller, sessionId: string): Promise<ConversationMessage[]> {
    return (await hub(mobileApi.getForemanConversation, { ...caller, query: { sessionId } }))?.messages ?? []
}

// General and its threads, newest first, in the shape a coworker's conversations have.
export async function fetchForemanConversations(caller: Caller): Promise<Conversation[]> {
    return hub(mobileApi.listForemanConversations, caller)
}

// A hub older than threads only says which run its last conversation has going, and answers the
// others with their transcript alone; so does a conversation whose transcript cannot be read.
export async function fetchForemanActiveRun(caller: Caller, sessionId: string): Promise<string | null> {
    const reply = await hub(mobileApi.getForemanConversation, { ...caller, query: { sessionId } })
    return reply && 'sessionId' in reply ? (reply.activeRunId ?? null) : null
}

export async function stopForeman(caller: Caller, sessionId: string, runId: string | null): Promise<void> {
    await hub(mobileApi.stopForeman, { ...caller, query: { sessionId, ...(runId ? { runId } : {}) } })
}
