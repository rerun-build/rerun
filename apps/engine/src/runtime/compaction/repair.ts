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

function withoutProviderExecuted(part: unknown): unknown {
    if (!isToolCallPart(part) || !('providerExecuted' in part)) return part
    const { providerExecuted: _providerExecuted, ...call } = part as ToolCallPart & { providerExecuted?: boolean }
    return call
}

// A Claude Code or Codex run leaves each tool the CLI ran as a call and its result side by side in the
// assistant message. The OpenAI chat format has no place for a result there: the SDK drops it and
// sends the call alone, which Mistral refuses outright. The assistant message is cut at each result,
// which goes into a tool message of its own, the way a tool Rerun ran is replayed.
export function withToolResultsInToolMessages(messages: ModelMessage[]): ModelMessage[] {
    return messages.flatMap(message => {
        const content = message.content as unknown
        if (message.role !== 'assistant' || !Array.isArray(content) || !content.some(isToolResultPart)) return [message]
        const split: ModelMessage[] = []
        let assistant: unknown[] = []
        let results: ToolResultPart[] = []
        const flushAssistant = () => {
            if (assistant.length > 0) split.push({ ...message, content: assistant } as ModelMessage)
            assistant = []
        }
        const flushResults = () => {
            if (results.length > 0) split.push({ role: 'tool', content: results } as ModelMessage)
            results = []
        }
        for (const part of content) {
            if (isToolResultPart(part)) {
                flushAssistant()
                results.push(part)
            } else {
                flushResults()
                assistant.push(withoutProviderExecuted(part))
            }
        }
        flushAssistant()
        flushResults()
        return split
    })
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
