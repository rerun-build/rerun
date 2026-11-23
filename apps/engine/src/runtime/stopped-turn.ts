import type { AssistantContent, ModelMessage, ToolResultPart } from 'ai'
import { contextTextPart } from '@rerun/contracts'
import { isHitlToolName } from '../tools/builtin/hitl.js'
import { withToolResultsInToolMessages } from './compaction/repair.js'

type AssistantPart = Exclude<AssistantContent, string>[number]

// A run another coworker called is stopped by the user, or with the run that called it.
type StoppedBy = 'the user' | 'the user or the calling coworker'

export const stoppedTurnNote = (by: StoppedBy): string => `This turn was stopped here by ${by}, before it finished.`
export const stoppedCallResult = (by: StoppedBy): string => `Stopped by ${by} before the result came back. The call may have gone through: check before doing it again.`

function isCard(part: { type: string; toolName?: string }): boolean {
    return (part.type === 'tool-call' || part.type === 'tool-result') && isHitlToolName(part.toolName)
}

// Stopping a turn closes the card it had put up: kept, it would read as still waiting for an answer.
function withoutCards(message: ModelMessage): ModelMessage[] {
    if ((message.role !== 'assistant' && message.role !== 'tool') || !Array.isArray(message.content)) return [message]
    const content = (message.content as AssistantPart[]).filter(part => !isCard(part))
    return content.some(part => part.type !== 'reasoning') ? [{ ...message, content } as ModelMessage] : []
}

function withStoppedCalls(messages: ModelMessage[], by: StoppedBy): ModelMessage[] {
    const results = messages.flatMap(message => (message.role === 'tool' ? message.content : []))
    const answered = new Set(results.flatMap(part => (part.type === 'tool-result' ? [part.toolCallId] : [])))
    const out: ModelMessage[] = []
    let stopped: ToolResultPart[] = []
    for (const message of messages) {
        if (message.role === 'tool') {
            out.push({ ...message, content: [...message.content, ...stopped] })
            stopped = []
            continue
        }
        if (stopped.length > 0) out.push({ role: 'tool', content: stopped })
        const calls = message.role === 'assistant' && typeof message.content !== 'string' ? message.content.filter(part => part.type === 'tool-call') : []
        stopped = calls
            .filter(call => !answered.has(call.toolCallId))
            .map(call => ({ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, output: { type: 'error-text', value: stoppedCallResult(by) } }))
        out.push(message)
    }
    if (stopped.length > 0) out.push({ role: 'tool', content: stopped })
    return out
}

/**
 * What a stopped turn leaves in the conversation: what it said and did, so the next turn
 * neither denies it nor does it twice, and a note the chat never shows saying where it stopped. The
 * results go in tool messages, the only place Claude Code reads them back from.
 */
export function stoppedTurn(messages: ModelMessage[], by: StoppedBy): ModelMessage[] {
    const kept = withStoppedCalls(withToolResultsInToolMessages(messages.flatMap(withoutCards)), by)
    if (kept.length === 0) return []
    const last = kept[kept.length - 1]
    const note = contextTextPart(stoppedTurnNote(by))
    if (last.role !== 'assistant' || typeof last.content === 'string') return [...kept, { role: 'assistant', content: [note] }]
    return [...kept.slice(0, -1), { ...last, content: [...last.content, note] }]
}
