import type { ModelMessage } from 'ai'
import { COMPACTION_CHARS_PER_TOKEN } from './config.js'

function partText(part: unknown): string {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const p = part as Record<string, unknown>
    if (typeof p.text === 'string') return p.text
    if (p.type === 'tool-call') return JSON.stringify(p.input ?? p.args ?? {})
    if (p.type === 'tool-result') return JSON.stringify(p.output ?? p.result ?? {})
    if (typeof p.input !== 'undefined') return JSON.stringify(p.input)
    if (typeof p.output !== 'undefined') return JSON.stringify(p.output)
    return JSON.stringify(p)
}

export function messageChars(message: ModelMessage): number {
    const content = message.content as unknown
    if (typeof content === 'string') return content.length
    if (Array.isArray(content)) return content.reduce((sum, part) => sum + partText(part).length, 0)
    return 0
}

export function estimateTokens(messages: ModelMessage[], system?: string, extraChars = 0): number {
    const systemChars = system ? system.length : 0
    const messageChars_ = messages.reduce((sum, m) => sum + messageChars(m), 0)
    return Math.ceil((systemChars + messageChars_ + extraChars) / COMPACTION_CHARS_PER_TOKEN)
}
