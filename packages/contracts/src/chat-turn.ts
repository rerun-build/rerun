// The user message that opens the turn holding `messageId`, or the last turn without it. A turn read
// back from the engine is one message per step, and the AI SDK's `regenerate` only drops the message it
// is pointed at: aimed at a step, it would leave the steps before it and send an empty text.
export function turnOpenerId(messages: readonly { id: string; role: string }[], messageId?: string): string | undefined {
    const from = messageId === undefined ? messages.length - 1 : messages.findIndex(message => message.id === messageId)
    for (let index = from; index >= 0; index--) {
        if (messages[index].role === 'user') return messages[index].id
    }
    return undefined
}
