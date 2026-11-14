import type { Conversation } from '@rerun/contracts'

export type ThreadItem = Pick<Conversation, 'title' | 'status' | 'source' | 'automationName' | 'outcome' | 'originAgentName'> & { id: string; createdAt: string; firstMessage?: string | null }

export const GENERAL_THREAD_LIMIT = 200

export function generalThreadsOf(conversations: readonly Conversation[]): ThreadItem[] {
    return conversations
        .flatMap(conversation =>
            conversation.kind === 'thread' && conversation.id && conversation.createdAt
                ? [{ id: conversation.id, title: conversation.title, status: conversation.status, source: conversation.source, automationName: conversation.automationName, outcome: conversation.outcome, originAgentName: conversation.originAgentName, createdAt: conversation.createdAt, firstMessage: conversation.firstMessage }]
                : []
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, GENERAL_THREAD_LIMIT)
}
