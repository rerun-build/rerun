import { appendAttachmentsRef, buildAttachmentsRef, parseAttachments } from './chat-attachments.js'
import { parseQuote, prependQuote } from './chat-quote.js'
import { messageText } from './message-text.js'
import { parseVoiceMessage } from './voice.js'

// A message read back from a conversation's history carries the id of its engine row behind this
// prefix. One the app has just streamed carries an id of its own until the history is read again.
export const ENGINE_MESSAGE_ID_PREFIX = 'engine-'

export function engineMessageIdOf(messageId: string): string | null {
    return messageId.startsWith(ENGINE_MESSAGE_ID_PREFIX) ? messageId.slice(ENGINE_MESSAGE_ID_PREFIX.length) : null
}

// The hub's answer when the machine of the workspace predates message edits (ENGINE_CAPABILITY_MESSAGE_EDIT).
export const MESSAGE_EDIT_ENGINE_OUTDATED = 'engine_outdated'

// A message to edit or delete that is no longer in the conversation.
export const MESSAGE_NOT_FOUND = 'message_not_found'

type PartLike = { type: string; text?: string }
type MessageLike = { id: string; role: string; parts: readonly PartLike[] }

// The words of a message of the user as an editor shows them, and how an edit is sent back with the
// passage it quoted and the files it carried. A voice message is a recording: there is nothing to edit.
export function editableTextOf(message: MessageLike): { text: string; rebuild: (edited: string) => string } | null {
    if (message.role !== 'user') return null
    const quoted = parseQuote(messageText(message))
    const full = quoted?.text ?? messageText(message)
    const attachments = parseAttachments(full)
    const text = attachments?.text ?? full
    if (parseVoiceMessage(text)) return null
    const withFiles = (edited: string) => (attachments ? appendAttachmentsRef(edited, buildAttachmentsRef(attachments.paths)) : edited.trim())
    return { text, rebuild: edited => prependQuote(withFiles(edited), quoted?.quote) }
}

export function userIndexBefore(messages: readonly MessageLike[], index: number): number {
    for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') return i
    return -1
}

// The messages of the coworker's reply around `index`: the engine deletes a reply whole.
export function replyBounds(messages: readonly MessageLike[], index: number): { start: number; end: number } {
    let start = index
    while (start > 0 && messages[start - 1].role !== 'user') start--
    let end = index + 1
    while (end < messages.length && messages[end].role !== 'user') end++
    return { start, end }
}

// What the person wrote, without the files: a message streamed on the phone carries them as parts,
// the history as a reference in the text.
function wordsOf(message: MessageLike): string {
    const full = messageText(message)
    return (parseAttachments(full)?.text ?? full).trim()
}

const userIndexesOf = (messages: readonly MessageLike[]) => messages.flatMap((item, at) => (item.role === 'user' ? [at] : []))

// The rank alone misleads: a Retry sends the message again under a second row the chat never shows,
// and a teammate or a routine may have written after it. Among the rows with the same words, the one
// at the same rank from the end, then from the start, then the only one.
function userCounterpartIndex(live: readonly MessageLike[], index: number, history: readonly MessageLike[]): number | null {
    const liveUsers = userIndexesOf(live)
    const rank = liveUsers.indexOf(index)
    const historyUsers = userIndexesOf(history)
    const words = wordsOf(live[index])
    const candidates = historyUsers.filter(at => wordsOf(history[at]) === words)
    const fromEnd = historyUsers[historyUsers.length - (liveUsers.length - rank)]
    if (fromEnd !== undefined && candidates.includes(fromEnd)) return fromEnd
    const fromStart = historyUsers[rank]
    if (fromStart !== undefined && candidates.includes(fromStart)) return fromStart
    return candidates.length === 1 ? candidates[0] : null
}

// The message of the history read back that stands for `live[index]`, one the chat streamed and still
// holds under an id of its own. The live chat keeps a reply in one message where the history may split
// it, so a reply maps to the first message of the coworker that has words after the same message of the user.
export function counterpartIn(live: readonly MessageLike[], index: number, history: readonly MessageLike[]): string | null {
    const message = live[index]
    if (!message) return null
    if (message.role === 'user') {
        const at = userCounterpartIndex(live, index, history)
        return at === null ? null : history[at].id
    }
    const liveUser = userIndexBefore(live, index)
    const historyUser = liveUser < 0 ? -1 : userCounterpartIndex(live, liveUser, history)
    if (historyUser === null) return null
    for (let at = historyUser + 1; at < history.length && history[at].role !== 'user'; at++) {
        if (history[at].role === 'assistant' && messageText(history[at]).length > 0) return history[at].id
    }
    return null
}

export type MessageEditRefusal = 'engineOutdated' | 'notFound'

// The hub refused a send that replaces a message: the conversation on screen was already cut, and the
// machine kept it whole.
export function messageEditRefusalOf(errorText: string): MessageEditRefusal | null {
    if (errorText.includes(MESSAGE_EDIT_ENGINE_OUTDATED)) return 'engineOutdated'
    if (errorText.includes(MESSAGE_NOT_FOUND)) return 'notFound'
    return null
}

export const MESSAGE_LINK_PARAM = 'message'
export const SESSION_LINK_PARAM = 'session'

// A link that opens the conversation on that message in the web app.
export function messageLinkOf(origin: string, link: { agentId: string; sessionId: string; messageId: string }): string {
    const params = new URLSearchParams({ agent: link.agentId, [SESSION_LINK_PARAM]: link.sessionId, [MESSAGE_LINK_PARAM]: link.messageId })
    return `${origin}/?${params.toString()}`
}
