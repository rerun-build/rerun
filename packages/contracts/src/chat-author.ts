import { parseInstallMessage } from './chat-run-origin.js'
import { messageText } from './message-text.js'

export type AuthorProfile = { id: string; name: string; photo?: string }

export const FORMER_MEMBER: AuthorProfile = { id: 'gone', name: 'Former member' }

type PartLike = { type: string; text?: string }
type AuthoredMessageLike = { id: string; role: string; parts: readonly PartLike[]; metadata?: unknown }

export type AuthorTurn<M> = { key: string; authorId: string | undefined; relayed: boolean; items: { message: M; index: number }[] }

/**
 * Who typed a message, when someone did. A schedule, a trigger or the API leave it unsigned, and so
 * does an install guide: it is the template speaking, sent on the click of a button.
 */
export function authorIdOf(message: AuthoredMessageLike): string | undefined {
    if (message.role !== 'user') return undefined
    const metadata = message.metadata as { authorId?: unknown; install?: unknown } | null | undefined
    const authorId = metadata?.authorId
    if (typeof authorId !== 'string' || !authorId || metadata?.install) return undefined
    return parseInstallMessage(messageText(message)) ? undefined : authorId
}

/** The Chief of Staff sent this message in its author's name, answering a card they were owed. */
export function isRelayedMessage(message: AuthoredMessageLike): boolean {
    return message.role === 'user' && (message.metadata as { relayedBy?: unknown } | null | undefined)?.relayedBy === 'foreman'
}

/**
 * Consecutive messages one person sent become one turn; everything else stands alone. What the Chief
 * of Staff sent for them is a turn of its own: it is not what they typed.
 */
export function authorTurnsOf<M extends AuthoredMessageLike>(messages: readonly M[]): AuthorTurn<M>[] {
    const turns: AuthorTurn<M>[] = []
    messages.forEach((message, index) => {
        const authorId = authorIdOf(message)
        const relayed = authorId !== undefined && isRelayedMessage(message)
        const last = turns.at(-1)
        if (last && authorId !== undefined && last.authorId === authorId && last.relayed === relayed) last.items.push({ message, index })
        else turns.push({ key: message.id, authorId, relayed, items: [{ message, index }] })
    })
    return turns
}
