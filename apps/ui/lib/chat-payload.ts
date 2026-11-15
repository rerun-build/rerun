import { isTextUIPart, type UIMessage } from 'ai'

export function lastUserText(messages: UIMessage[]): string {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user') return ''

    return last.parts
        .filter(isTextUIPart)
        .map(part => part.text)
        .join('')
}
