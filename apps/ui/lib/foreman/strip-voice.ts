import type { UIMessage } from 'ai'

import { appendAttachmentsRef, buildAttachmentsRef, parseAttachments } from '@/lib/chat/attachments-marker'
import { parseVoiceMessage } from '@/lib/voice/marker'

export function withoutVoiceMarkers(messages: UIMessage[]): UIMessage[] {
    let stripped = false

    const next = messages.map(message => {
        if (message.role !== 'user') return message

        const last = message.parts.findLastIndex(part => part.type === 'text')
        if (last < 0) return message

        const text = (message.parts[last] as { text: string }).text
        const attachments = parseAttachments(text)
        const voice = parseVoiceMessage(attachments?.text ?? text)
        if (!voice?.transcript) return message

        stripped = true
        const modelText = attachments ? appendAttachmentsRef(voice.transcript, buildAttachmentsRef(attachments.paths)) : voice.transcript
        const parts = message.parts.map((part, index) => (index === last ? { ...part, text: modelText } : part))
        return { ...message, parts }
    })

    return stripped ? (next as UIMessage[]) : messages
}
