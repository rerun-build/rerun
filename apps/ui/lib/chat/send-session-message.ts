import type { ModelSelection } from '@/hooks/useAgentModel'

export type SendSessionMessageResult = 'sent' | 'busy' | 'failed'

type SendSessionMessageArgs = { agentId: string; sessionId: string; text: string; model?: ModelSelection }

// Posts a message to a conversation without showing its answer: the same route as the chat, whose
// stream is let go once the run has started. The engine runs it to the end on its own, and the chat
// attaches to it when the conversation is opened. Sent as `queued`: a conversation still busy
// answers `run_in_flight` rather than having this text dropped behind a run already under way.
export async function sendSessionMessage({ agentId, sessionId, text, model }: SendSessionMessageArgs): Promise<SendSessionMessageResult> {
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, sessionId, text, connectionId: model?.connectionId, model: model?.model, queued: true }),
        })
        await res.body?.cancel().catch(() => {})
        if (res.ok) return 'sent'
        return res.status === 409 ? 'busy' : 'failed'
    } catch {
        return 'failed'
    }
}

// The same, to a thread of the Chief of Staff: its conversations run through a route of their own.
export async function sendForemanThreadMessage({ sessionId, text, model }: Omit<SendSessionMessageArgs, 'agentId'>): Promise<SendSessionMessageResult> {
    try {
        const res = await fetch('/api/chat/foreman/engine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, kind: 'thread', text, connectionId: model?.connectionId, model: model?.model, queued: true }),
        })
        await res.body?.cancel().catch(() => {})
        if (res.ok) return 'sent'
        return res.status === 409 ? 'busy' : 'failed'
    } catch {
        return 'failed'
    }
}
