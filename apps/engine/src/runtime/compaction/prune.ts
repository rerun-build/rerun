import type { ModelMessage } from 'ai'
import { COMPACTION_PRUNE_OUTPUT_CHAR_THRESHOLD } from './config.js'

type ToolResultOutput = { type: string; value?: unknown; reason?: string }
type ToolResultPart = { type: 'tool-result'; toolCallId: string; toolName: string; output: ToolResultOutput; providerOptions?: unknown }

function isToolResultPart(part: unknown): part is ToolResultPart {
    return !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool-result'
}

function outputSize(output: ToolResultOutput): number {
    if (output.type === 'text' || output.type === 'error-text') return typeof output.value === 'string' ? output.value.length : 0
    return JSON.stringify(output.value ?? output.reason ?? '').length
}

function prunablePart(part: ToolResultPart): boolean {
    if (part.output.type !== 'text' && part.output.type !== 'json' && part.output.type !== 'content') return false
    return outputSize(part.output) > COMPACTION_PRUNE_OUTPUT_CHAR_THRESHOLD
}

function savedPointerOf(output: ToolResultOutput): string {
    const value = output.value as { saved?: unknown } | string | undefined
    const page = typeof value === 'string' ? /Saved whole: (\.rerun\/pages\/\S+)/.exec(value)?.[1] : undefined
    if (page) return `; the whole page is saved at ${page}, read or grep it`
    const handle = typeof value === 'string' ? /Saved whole: (\.rerun\/results\/[^\s,]+\.txt), lines 1-(\d+)/.exec(value) : null
    if (handle) return `; the whole result is saved at ${handle[1]}, lines 1-${handle[2]}, read or grep it`
    const answer = typeof value === 'string' ? /"saved":"(\.rerun\/paid-data\/[^"]+)"/.exec(value)?.[1] : typeof value?.saved === 'string' ? value.saved : undefined
    return answer ? `; the whole answer is saved at ${answer}, read it with paid_data_read` : ''
}

export type PruneResult = { messages: ModelMessage[]; prunedCount: number; prunedChars: number }

export function pruneToolOutputs(messages: ModelMessage[], tailStart: number): PruneResult {
    let prunedCount = 0
    let prunedChars = 0
    const seen = new Map<string, number>()

    const out = messages.map((message, index) => {
        if (index >= tailStart) return message
        const content = message.content as unknown
        if (!Array.isArray(content)) return message

        let changed = false
        const parts = content.map(part => {
            if (!isToolResultPart(part) || !prunablePart(part)) return part
            const size = outputSize(part.output)
            const dedupKey = `${part.toolName}:${size}:${JSON.stringify(part.output.value ?? '').slice(0, 256)}`
            const firstAt = seen.get(dedupKey)
            const pointer = savedPointerOf(part.output)
            const value = `${typeof firstAt === 'number' ? `[pruned] ${part.toolName} output (~${size} chars) — duplicate of an earlier identical result` : `[pruned] ${part.toolName} output (~${size} chars) elided to save context`}${pointer}`
            if (typeof firstAt !== 'number') seen.set(dedupKey, index)
            changed = true
            prunedCount += 1
            prunedChars += size
            return { type: 'tool-result', toolCallId: part.toolCallId, toolName: part.toolName, output: { type: 'text', value } }
        })

        return changed ? ({ ...message, content: parts } as ModelMessage) : message
    })

    return { messages: out, prunedCount, prunedChars }
}
