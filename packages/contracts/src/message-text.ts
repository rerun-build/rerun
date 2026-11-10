export function messageText(message: { parts: readonly { type: string; text?: string }[] }): string {
    return message.parts.map(part => (part.type === 'text' ? (part.text ?? '') : '')).join('')
}
