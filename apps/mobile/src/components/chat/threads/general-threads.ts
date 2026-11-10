import type { Conversation } from '@rerun/contracts'

export type ThreadItem = Pick<Conversation, 'title' | 'status' | 'source' | 'automationName' | 'outcome' | 'originAgentName'> & { id: string; createdAt: string; firstMessage?: string | null }

// The web's General reads its threads with this cap (`THREAD_FEED_LIMIT`): the newest ones, the
// Threads menu stays the way to every older one.
export const GENERAL_THREAD_LIMIT = 200

/**
 * The threads General hangs between its messages, as the web lists them: the coworker's
 * conversations other than General that the hub keeps a row of. One another coworker opened on the
 * Box and nobody adopted yet has no id and stays in the Threads menu only.
 */
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
