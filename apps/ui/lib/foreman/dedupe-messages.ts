import type { UIMessage } from 'ai'

export function dedupeMessagesById(messages: UIMessage[]): UIMessage[] {
    const lastCopy = new Map<string, UIMessage>()
    for (const message of messages) if (message.id) lastCopy.set(message.id, message)
    if (lastCopy.size === messages.filter(message => message.id).length) return messages

    const placed = new Set<string>()
    const deduped: UIMessage[] = []
    for (const message of messages) {
        if (!message.id) {
            deduped.push(message)
            continue
        }
        if (placed.has(message.id)) continue
        placed.add(message.id)
        deduped.push(lastCopy.get(message.id) ?? message)
    }
    return deduped
}
