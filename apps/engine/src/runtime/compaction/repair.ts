import type { ModelMessage } from 'ai'

type ToolCallPart = { type: 'tool-call'; toolCallId: string; toolName: string }
type ToolResultPart = { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }

function isToolCallPart(part: unknown): part is ToolCallPart {
    return !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool-call'
}

function isToolResultPart(part: unknown): part is ToolResultPart {
    return !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool-result'
}

function stubResult(call: ToolCallPart): ToolResultPart {
    return { type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, output: { type: 'text', value: '[tool result unavailable: omitted during context compaction]' } }
}

export function repairToolPairs(messages: ModelMessage[]): ModelMessage[] {
    const callIds = new Set<string>()
    const resultIds = new Set<string>()
    for (const message of messages) {
        const content = message.content as unknown
        if (!Array.isArray(content)) continue
        for (const part of content) {
            if (isToolCallPart(part)) callIds.add(part.toolCallId)
            else if (isToolResultPart(part)) resultIds.add(part.toolCallId)
        }
    }

    const out: ModelMessage[] = []
    for (const message of messages) {
        const content = message.content as unknown
        if (!Array.isArray(content)) {
            out.push(message)
            continue
        }

        const filtered = content.filter(part => !isToolResultPart(part) || callIds.has(part.toolCallId))
        if (filtered.length === 0 && message.role === 'tool') continue
        const repaired = (filtered === content ? message : ({ ...message, content: filtered } as ModelMessage))
        out.push(repaired)

        if (message.role === 'assistant') {
            const missing = filtered.filter(isToolCallPart).filter(call => !resultIds.has(call.toolCallId))
            if (missing.length > 0) out.push({ role: 'tool', content: missing.map(stubResult) } as ModelMessage)
        }
    }

    return out
}
