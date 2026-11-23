import type { ModelMessage } from 'ai'

export function thoughtsOf(messages: ModelMessage[] = []): string[] {
    return messages.flatMap(message => (Array.isArray(message.content) ? message.content : []).flatMap(part => (part.type === 'reasoning' ? [part.text] : [])))
}
