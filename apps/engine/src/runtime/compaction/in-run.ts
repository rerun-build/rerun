import type { ModelMessage } from 'ai'
import { isContextPart } from '@rerun/contracts'
import { CLI_PROVIDERS } from '../../agents/types.js'
import type { ModelOverride } from '../../agents/providers.js'
import { newId } from '../../lib/ids.js'
import type { RunContext } from '../context.js'
import { compactionThreshold, recordCompactionUsage, runContextWindow, summarizeMiddle, summaryMessageOf } from './compact.js'
import { COMPACTION_TAIL_TOKEN_BUDGET } from './config.js'
import { estimateTokens } from './estimate.js'
import { pruneToolOutputs } from './prune.js'
import { repairToolPairs } from './repair.js'
import { tailStartIndex } from './split.js'

// The summary taken before a run says its requests were already answered. One taken in the middle
// of a run covers the very request still being worked on, which is repeated right after it.
export const IN_RUN_SUMMARY_PREAMBLE =
    'The following is a compacted summary of this conversation so far, including the work already done on the request that follows it. That request is still open: carry it on from where the summary leaves off, and do not redo the actions it lists as completed.'

type StepUsage = { usage?: { inputTokens?: number; outputTokens?: number } }

export type InRunCompactionInput = { messages: ModelMessage[]; steps: ReadonlyArray<StepUsage>; stepNumber: number }

/** Returns the messages the next step is sent, or `undefined` when they go as they are. */
export type InRunCompactor = (input: InRunCompactionInput) => Promise<ModelMessage[] | undefined>

type Compacted = { summary: ModelMessage; coveredCount: number }

export type InRunCompactorOptions = { system: string; toolChars: number; override?: ModelOverride; initialMessages: ModelMessage[] }

function hasOwnText(message: ModelMessage): boolean {
    if (typeof message.content === 'string') return message.content.trim().length > 0
    const parts = message.content as Array<{ type: string; text?: unknown }>
    return parts.some(part => part.type === 'text' && !isContextPart(part) && typeof part.text === 'string' && part.text.trim().length > 0)
}

// The request the run is answering. A backup that carries on a turn ends it with a note of its own,
// a context part, so the request is the last user message that says something.
export function turnIndexOf(messages: ModelMessage[]): number | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && hasOwnText(messages[i])) return i
    }
    return undefined
}

function lastAssistantIndex(messages: ModelMessage[]): number {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i
    return messages.length
}

// The cut never leaves the latest step out of the tail, so the model always reads its own last call
// and what it returned, and never opens the tail on a tool result whose call went to the summary.
function cutIndex(view: ModelMessage[]): number {
    let cut = Math.min(tailStartIndex(view, COMPACTION_TAIL_TOKEN_BUDGET), lastAssistantIndex(view))
    while (cut < view.length && view[cut].role === 'tool') cut++
    return cut
}

/**
 * The CLI providers run a whole turn as one step, out of reach of the loop: only the providers whose
 * steps the loop drives (the APIs, OpenCode) can be compacted between two of them.
 */
export function createInRunCompactor(ctx: RunContext, { system, toolChars, override, initialMessages }: InRunCompactorOptions): InRunCompactor | undefined {
    if (CLI_PROVIDERS.has(ctx.provider)) return undefined
    const contextWindow = runContextWindow(ctx.model, ctx.provider, ctx.agent.resolved.connection)
    if (!contextWindow) return undefined
    const threshold = compactionThreshold(contextWindow, ctx.provider)
    const turnIndex = turnIndexOf(initialMessages)

    let compacted: Compacted | undefined
    // After a summary, done or failed, the next waits for the context to grow by another tail's
    // worth. When the prompt and the tools alone fill most of the window (a small local model),
    // the compacted run is still past the threshold, and every step would pay a summary to win back
    // a few hundred tokens. A provider having a bad minute gets the same respite.
    let nextCompactionAt = 0

    // The request the summary covers is sent again right after it.
    const pinnedOf = (messages: ModelMessage[], coveredCount: number): ModelMessage[] => (turnIndex !== undefined && turnIndex < coveredCount ? [messages[turnIndex]] : [])

    // The SDK hands every step the full list again, so the summary is put back each time.
    const viewOf = (messages: ModelMessage[]): { view: ModelMessage[]; synthetic: number } => {
        if (!compacted) return { view: messages, synthetic: 0 }
        const pinned = pinnedOf(messages, compacted.coveredCount)
        return { view: [compacted.summary, ...pinned, ...messages.slice(compacted.coveredCount)], synthetic: 1 + pinned.length }
    }

    return async ({ messages, steps, stepNumber }) => {
        // The opening step reads the history `prepareRunHistory` just compacted, or failed to.
        if (stepNumber === 0) return undefined
        const { view, synthetic } = viewOf(messages)
        const kept = compacted ? repairToolPairs(view) : undefined
        const last = steps.at(-1)?.usage
        const measured = (last?.inputTokens ?? 0) + (last?.outputTokens ?? 0)
        const tokens = Math.max(measured, estimateTokens(view, system, toolChars))
        if (tokens < threshold || tokens < nextCompactionAt) return kept

        const cut = cutIndex(view)
        const coveredBefore = compacted?.coveredCount ?? 0
        const coveredCount = coveredBefore + cut - synthetic
        const pinned = pinnedOf(messages, coveredCount)
        // A request that stays pinned leaves nothing out of the context: it is not counted among
        // what the summary takes, and a summary that would take nothing else is not paid.
        const messagesCompacted = coveredCount - coveredBefore - (pinned.length - pinnedOf(messages, coveredBefore).length)
        if (messagesCompacted <= 0) return kept

        const checkpointId = newId()
        ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'running' } })
        try {
            const middle = pruneToolOutputs(view, cut).messages.slice(0, cut)
            const summary = await summarizeMiddle(ctx, override, middle)
            await recordCompactionUsage(ctx, stepNumber, summary)
            compacted = { summary: summaryMessageOf(IN_RUN_SUMMARY_PREAMBLE, summary.text), coveredCount }
            // Weighed against what the steps carried before the summary, not against the pruned copy
            // the summary was written from, where a large result is down to a line.
            const tokensRecovered = Math.max(0, estimateTokens(view.slice(0, cut)) - estimateTokens([compacted.summary, ...pinned]))
            ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'done', messagesCompacted, tokensRecovered } })
            ctx.logger.info({ agent: ctx.agent.id, session: ctx.sessionId, run: ctx.runId, stepNumber, tokens, messagesCompacted, tokensRecovered, usage: summary.usage }, 'context compacted mid-run')
            const sent = repairToolPairs(viewOf(messages).view)
            nextCompactionAt = estimateTokens(sent, system, toolChars) + COMPACTION_TAIL_TOKEN_BUDGET
            return sent
        } catch (error) {
            nextCompactionAt = tokens + COMPACTION_TAIL_TOKEN_BUDGET
            ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'error' } })
            ctx.logger.error({ agent: ctx.agent.id, run: ctx.runId, err: String(error) }, 'mid-run compaction failed')
            return kept
        }
    }
}
