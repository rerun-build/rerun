import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { randomUUID } from 'expo-crypto'

import { fetchActiveRun, fetchMessages, stopConversation } from '@/api/chat'
import type { FileOwner } from '@/api/files'
import { fetchForemanActiveRun, fetchForemanMessages, stopForeman } from '@/api/foreman'

type Caller = { accessToken: string; workspaceId: number }

// Where one conversation is sent, read back and stopped. A coworker talks through /api/chat and the
// hub names a new conversation in a header; the Foreman has its own route and is handed the id of
// the conversation by the app.
export type ChatEndpoints = {
    agentId: string
    sendPath: string
    sendBody: (sessionId: string | null, text: string) => Record<string, unknown>
    bornSessionOf: (response: Response) => string | null
    messages: (caller: Caller, sessionId: string) => Promise<UIMessage[]>
    activeRun: (caller: Caller, sessionId: string) => Promise<string | null>
    stop: (caller: Caller, sessionId: string, runId: string | null) => Promise<void>
    // Where the conversation's uploads go, before its first send included.
    fileOwner: (sessionId: string | null) => FileOwner
}

// `general`: the first send opens the coworker's General, or continues it if another device just did.
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

// Its files live in its own workspace on the machine once the machine takes them, in the hub's
// bucket before: the web column switches the same way. `general`: the page is the Foreman's General,
// which the hub continues if another device opened it first, and then names in a header.
export function foremanEndpoints(filesOnEngine: () => boolean, { general = false }: { general?: boolean } = {}): ChatEndpoints {
    const draftId = randomUUID()
    return {
        agentId: FOREMAN_AGENT_ID,
        sendPath: '/api/chat/foreman/engine',
        sendBody: (sessionId, text) => ({ sessionId: sessionId ?? draftId, kind: general ? 'general' : 'thread', text }),
        bornSessionOf: response => (response.ok ? (response.headers.get('X-Session-Id') ?? draftId) : null),
        messages: async (caller, sessionId) => (await fetchForemanMessages(caller, sessionId)) as UIMessage[],
        activeRun: fetchForemanActiveRun,
        stop: stopForeman,
        fileOwner: sessionId => (filesOnEngine() ? { kind: 'agent', agentId: FOREMAN_AGENT_ID } : { kind: 'foreman', sessionId: sessionId ?? draftId }),
    }
}
