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

function isRunByCli(part: unknown): part is ToolCallPart & { providerExecuted?: boolean } {
    return isToolCallPart(part) && 'providerExecuted' in part
}

function withoutProviderExecuted(part: unknown): unknown {
    if (!isRunByCli(part)) return part
    const { providerExecuted: _providerExecuted, ...call } = part
    return call
}

// A Claude Code or Codex run leaves each tool the CLI ran as a call and its result side by side in the
// assistant message. No API reads them there: Mistral refuses the call sent without its result, and
// Anthropic's SDK takes a `web_search` or a `web_fetch` for Anthropic's own and refuses the result of
// another (RER-270). The assistant message is cut at each result, which goes into a tool message of
// its own, the way a tool Rerun ran is replayed. A result that came late joins those of its message:
// Anthropic wants every call answered right after it. A call cut before its result is taken too: left
// provider-executed, the SDKs drop it and send the result `repairToolPairs` gives it alone.
export function withToolResultsInToolMessages(messages: ModelMessage[]): ModelMessage[] {
    return messages.flatMap(message => {
        const content = message.content as unknown
        if (message.role !== 'assistant' || !Array.isArray(content) || !content.some(part => isToolResultPart(part) || isRunByCli(part))) return [message]
        const split: ModelMessage[] = []
        const answered = new Set<string>()
        let assistant: unknown[] = []
        let results: ToolResultPart[] = []
        const addResult = (result: ToolResultPart) => {
            if (answered.has(result.toolCallId)) return
            answered.add(result.toolCallId)
            results.push(result)
        }
        const cut = () => {
            const calls = new Set(assistant.filter(isToolCallPart).map(call => call.toolCallId))
            if (results.length > 0) content.filter(isToolResultPart).filter(result => calls.has(result.toolCallId)).forEach(addResult)
            if (assistant.length > 0) split.push({ ...message, content: assistant } as ModelMessage)
            if (results.length > 0) split.push({ role: 'tool', content: results } as ModelMessage)
            assistant = []
            results = []
        }
        for (const part of content) {
            if (isToolResultPart(part)) {
                addResult(part)
                continue
            }
            if (results.length > 0) cut()
            assistant.push(withoutProviderExecuted(part))
        }
        cut()
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
