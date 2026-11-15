import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { randomUUID } from 'expo-crypto'

import { fetchActiveRun, fetchMessages, stopConversation } from '@/api/chat'
import type { FileOwner } from '@/api/files'
import { fetchForemanActiveRun, fetchForemanMessages, stopForeman } from '@/api/foreman'

type Caller = { accessToken: string; workspaceId: number }

export type ChatEndpoints = {
    agentId: string
    sendPath: string
    sendBody: (sessionId: string | null, text: string) => Record<string, unknown>
    bornSessionOf: (response: Response) => string | null
    messages: (caller: Caller, sessionId: string) => Promise<UIMessage[]>
    activeRun: (caller: Caller, sessionId: string) => Promise<string | null>
    stop: (caller: Caller, sessionId: string, runId: string | null) => Promise<void>
    fileOwner: (sessionId: string | null) => FileOwner
}

export function coworkerEndpoints(agentId: string, { general = false }: { general?: boolean } = {}): ChatEndpoints {
    return {
        agentId,
        sendPath: '/api/chat',
        sendBody: (sessionId, text) => (general && !sessionId ? { agentId, kind: 'general', text } : { agentId, sessionId: sessionId ?? undefined, text }),
        bornSessionOf: response => response.headers.get('X-Session-Id'),
        messages: async (caller, sessionId) => (await fetchMessages(caller, sessionId)) as UIMessage[],
        activeRun: fetchActiveRun,
        stop: (caller, sessionId) => stopConversation(caller, sessionId),
        fileOwner: () => ({ kind: 'agent', agentId }),
    }
}

export function foremanEndpoints(filesOnEngine: () => boolean): ChatEndpoints {
    const draftId = randomUUID()
    return {
        agentId: FOREMAN_AGENT_ID,
        sendPath: '/api/chat/foreman/engine',
        sendBody: (sessionId, text) => ({ sessionId: sessionId ?? draftId, text }),
        bornSessionOf: response => (response.ok ? draftId : null),
        messages: async (caller, sessionId) => (await fetchForemanMessages(caller, sessionId)) as UIMessage[],
        activeRun: fetchForemanActiveRun,
        stop: stopForeman,
        fileOwner: sessionId => (filesOnEngine() ? { kind: 'agent', agentId: FOREMAN_AGENT_ID } : { kind: 'foreman', sessionId: sessionId ?? draftId }),
    }
}
