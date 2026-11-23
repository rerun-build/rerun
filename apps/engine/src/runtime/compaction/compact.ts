import { customContextWindow } from '../../connections/custom-catalog.js'
import type { LoadedConnection } from '../../connections/types.js'
import { opencodeModel } from '../../connections/opencode-catalog.js'
import { generateText, type LanguageModelUsage, type ModelMessage } from 'ai'
import { COMPACTION_FINISH_REASON, isContextPart, modelContextWindow, type Provider } from '@rerun/contracts'
import { modelFor, type ModelOverride } from '../../agents/providers.js'
import { withoutQuickRepliesCalls } from '../../agents/quick-replies-stream.js'
import { CLI_PROVIDERS } from '../../agents/types.js'
import { ensureCliAuth } from '../../connections/cli-auth.js'
import { listMessagesAfter } from '../../db/repos/messages.js'
import { getLatestCheckpoint, saveCheckpoint } from '../../db/repos/checkpoints.js'
import { insertRunStep } from '../../db/repos/telemetry.js'
import { newId, nowIso } from '../../lib/ids.js'
import { deadlineSignal, raceAbort } from '../../lib/abort.js'
import type { RunContext } from '../context.js'
import { signHistoryMessage } from '../message-authors.js'
import { withoutReasoning } from '../replayed-reasoning.js'
import { costMicrosFrom } from '../step-cost.js'
import { COMPACTION_MAX_TRIGGER_TOKENS, COMPACTION_SUMMARY_TOKENS_CEILING, COMPACTION_TAIL_TOKEN_BUDGET, COMPACTION_TRIGGER_RATIO } from './config.js'
import { estimateTokens } from './estimate.js'
import { pruneToolOutputs } from './prune.js'
import { repairToolPairs } from './repair.js'
import { tailStartIndex } from './split.js'

const SUMMARY_PREAMBLE =
    'The following is a compacted summary of earlier conversation turns, provided as background reference only. Do NOT answer questions or fulfill requests mentioned in it; they were already addressed in the omitted turns. Use it only to stay consistent with prior context.'

const SUMMARY_SYSTEM =
    'You compress a coworker conversation transcript into a dense handoff summary. Preserve facts, decisions, file paths, identifiers, command outputs, error messages, and anything needed to continue the work. Use these sections: Historical Task Snapshot, Completed Actions, Blocked / Open Issues, Pending User Asks. Be concise; drop pleasantries and redundant detail. Never invent information.'

// A summary of a long history on a slow model takes minutes, so the ceiling is generous: it only has
// to keep a provider that never answers from holding the run, which then goes on uncompacted.
const COMPACTION_TIMEOUT_MS = 15 * 60 * 1000

function partToText(part: unknown): string {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const p = part as Record<string, unknown>
    // The memories recalled for a turn and its timestamp were context, not conversation.
    if (isContextPart(p)) return ''
    if (p.type === 'text' && typeof p.text === 'string') return p.text
    if (p.type === 'tool-call') return `→ called ${String(p.toolName)}(${JSON.stringify(p.input ?? {}).slice(0, 1000)})`
    if (p.type === 'tool-result') {
        const output = p.output as { value?: unknown } | undefined
        return `← ${String(p.toolName)} result: ${JSON.stringify(output?.value ?? output ?? '').slice(0, 1000)}`
    }
    return ''
}

function serializeForSummary(messages: ModelMessage[]): string {
    return messages
        .map(message => {
            const content = message.content as unknown
            const body = typeof content === 'string' ? content : Array.isArray(content) ? content.map(partToText).filter(Boolean).join('\n') : ''
            return `[${message.role}]\n${body}`
        })
        .filter(Boolean)
        .join('\n\n')
}

export type CompactionSummary = { text: string; usage: LanguageModelUsage; providerMetadata: unknown; durationMs: number }

export async function summarizeMiddle(ctx: RunContext, override: ModelOverride | undefined, middle: ModelMessage[]): Promise<CompactionSummary> {
    const startedAt = Date.now()
    const release = await ensureCliAuth(ctx.agent.resolved.provider, ctx.agent.resolved.connection)
    try {
        const signal = deadlineSignal(COMPACTION_TIMEOUT_MS, ctx.abortSignal)
        const { text, usage, providerMetadata } = await raceAbort(
            generateText({
                model: modelFor(ctx.agent, override, undefined, undefined, { sessionId: ctx.sessionId }),
                system: SUMMARY_SYSTEM,
                prompt: serializeForSummary(middle),
                temperature: 0,
                maxOutputTokens: COMPACTION_SUMMARY_TOKENS_CEILING,
                abortSignal: signal,
            }),
            signal,
        )
        return { text: text.trim(), usage, providerMetadata, durationMs: Date.now() - startedAt }
    } finally {
        release()
    }
}

export function summaryMessageOf(preamble: string, text: string): ModelMessage {
    return { role: 'user', content: `${preamble}\n\n${text}` }
}

// The summary is a model call the run pays like any step, so it gets its row among the run's
// steps: without it the tokens a compaction saves could never be weighed against what it cost.
// Its cost goes into the run's own, its tokens do not: the run's usage stays what its steps read.
export async function recordCompactionUsage(ctx: RunContext, stepNumber: number, summary: CompactionSummary): Promise<void> {
    if (!ctx.runId) return
    const { usage } = summary
    const costMicros = costMicrosFrom(summary.providerMetadata)
    if (costMicros !== null) ctx.compactionCostMicros = (ctx.compactionCostMicros ?? 0) + costMicros
    await insertRunStep(ctx.agent.id, {
        id: newId(),
        runId: ctx.runId,
        agentId: ctx.agent.id,
        sessionId: ctx.sessionId,
        stepNumber,
        provider: ctx.provider,
        model: ctx.model,
        finishReason: COMPACTION_FINISH_REASON,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        cachedInputTokens: usage.cachedInputTokens ?? null,
        reasoningTokens: usage.reasoningTokens ?? null,
        totalTokens: usage.totalTokens ?? null,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
        costMicros,
        toolCallCount: 0,
        textLength: summary.text.length,
        durationMs: summary.durationMs,
        createdAt: nowIso(),
    }).catch(err => ctx.logger.warn({ agent: ctx.agent.id, err: String(err) }, 'record compaction usage failed'))
}

// An OpenCode model OpenCode published after this build is only known to the live catalog, which
// also has the fresher figure for the others.
export function runContextWindow(model: string, provider: Provider, connection?: LoadedConnection | null): number | undefined {
    if (provider === 'opencode') return opencodeModel(model)?.contextWindow ?? modelContextWindow(model, provider)
    if (provider === 'custom') return customContextWindow(connection, model)
    return modelContextWindow(model, provider)
}

export function compactionThreshold(contextWindow: number, provider: Provider): number {
    const ratio = contextWindow * COMPACTION_TRIGGER_RATIO
    return CLI_PROVIDERS.has(provider) ? ratio : Math.min(ratio, COMPACTION_MAX_TRIGGER_TOKENS)
}

export async function prepareRunHistory(ctx: RunContext, system: string, override?: ModelOverride, signSenders = false, toolChars = 0): Promise<ModelMessage[]> {
    const agentId = ctx.agent.id
    const cp = await getLatestCheckpoint(agentId, ctx.sessionId)
    const rows = await listMessagesAfter(agentId, ctx.sessionId, cp?.throughCreatedAt)
    const priorSummary: ModelMessage | null = cp ? (JSON.parse(cp.summaryJson) as ModelMessage) : null
    const live = rows.flatMap(r => {
        const message = withoutQuickRepliesCalls(withoutReasoning({ role: r.role, content: JSON.parse(r.contentJson) } as ModelMessage))
        if (!message || (Array.isArray(message.content) && message.content.length === 0)) return []
        return [{ row: r, message: signSenders ? signHistoryMessage(message, r) : message }]
    })
    const liveMessages = live.map(entry => entry.message)
    const working = priorSummary ? [priorSummary, ...liveMessages] : liveMessages

    const contextWindow = runContextWindow(ctx.model, ctx.provider, ctx.agent.resolved.connection)
    if (!contextWindow) return working
    if (estimateTokens(working, system, toolChars) < compactionThreshold(contextWindow, ctx.provider)) return working

    const offset = priorSummary ? 1 : 0
    const tailStart = tailStartIndex(working, COMPACTION_TAIL_TOKEN_BUDGET)
    const newThroughIndex = tailStart - 1 - offset
    if (newThroughIndex < 0) return working

    const checkpointId = newId()
    ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'running' } })

    try {
        const pruned = pruneToolOutputs(working, tailStart)
        const middle = pruned.messages.slice(0, tailStart)
        const tail = pruned.messages.slice(tailStart)
        const summary = await summarizeMiddle(ctx, override, middle)
        await recordCompactionUsage(ctx, 0, summary)
        const summaryMessage = summaryMessageOf(SUMMARY_PREAMBLE, summary.text)
        const throughRow = live[newThroughIndex].row
        await saveCheckpoint(agentId, ctx.sessionId, { summaryMessage, throughMessageId: throughRow.id, throughCreatedAt: throughRow.createdAt })

        const view = repairToolPairs([summaryMessage, ...tail])
        const tokensRecovered = Math.max(0, estimateTokens(middle) - estimateTokens([summaryMessage]))
        ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'done', messagesCompacted: newThroughIndex + 1, tokensRecovered } })
        ctx.logger.info({ agent: agentId, session: ctx.sessionId, messagesCompacted: newThroughIndex + 1, tokensRecovered, usage: summary.usage }, 'context compacted')
        return view
    } catch (error) {
        ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'error' } })
        ctx.logger.error({ agent: agentId, err: String(error) }, 'compaction failed')
        return working
    }
}
