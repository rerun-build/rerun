import { customContextWindow } from '../../connections/custom-catalog.js'
import type { LoadedConnection } from '../../connections/types.js'
import { opencodeModel } from '../../connections/opencode-catalog.js'
import { generateText, type LanguageModelUsage, type ModelMessage } from 'ai'
import { COMPACTION_FINISH_REASON, isContextPart, modelContextWindow, type Provider } from '@rerun/contracts'
import { modelFor, type ModelOverride } from '../../agents/providers.js'
import { withoutQuickRepliesCalls } from '../../agents/quick-replies-stream.js'
import { CLI_PROVIDERS } from '../../agents/types.js'
import { CUSTOM_ENDPOINT_PATIENCE_MS } from '../../agents/custom-endpoint-fetch.js'
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
import { COMPACTION_MAX_TRIGGER_TOKENS, COMPACTION_SUMMARY_INPUT_CHARS_PER_TOKEN, COMPACTION_SUMMARY_TOKENS_CEILING, COMPACTION_TAIL_TOKEN_BUDGET, COMPACTION_TRIGGER_RATIO } from './config.js'
import { estimateTokens } from './estimate.js'
import { savedPointerOf } from './prune.js'
import { repairToolPairs } from './repair.js'
import { tailStartIndex } from './split.js'

const SUMMARY_PREAMBLE =
    'The following is a compacted summary of earlier conversation turns, provided as background reference only. Do NOT answer questions or fulfill requests mentioned in it; they were already addressed in the omitted turns. Use it only to stay consistent with prior context.'

const SUMMARY_SYSTEM =
    'You compress a coworker conversation transcript into a dense handoff summary. Preserve facts, decisions, file paths, identifiers, command outputs, error messages, and anything needed to continue the work. Use these sections: Historical Task Snapshot, Completed Actions, Blocked / Open Issues, Pending User Asks. Be concise; drop pleasantries and redundant detail. Never invent information.'

const SUMMARY_TITLE = 'Historical Task Snapshot'

// A transcript mostly ends on a tool result, and a model left with nothing after it may carry on the
// work or answer the user instead of summarising.
const SUMMARY_REQUEST = `The transcript above is over: do not continue it, call no tool and answer nobody in it. Write the handoff summary now, starting with the line "## ${SUMMARY_TITLE}". Keep the section titles in English whatever the language of the transcript.`

// A summary of a long history on a slow model takes minutes, so the ceiling is generous: it only has
// to keep a provider that never answers from holding the run, which then goes on uncompacted. A
// custom endpoint (a local model) reads a long prompt for as long as one of its steps would.
const COMPACTION_TIMEOUT_MS = 15 * 60 * 1000

function summaryTimeoutMs(provider: Provider): number {
    return provider === 'custom' ? CUSTOM_ENDPOINT_PATIENCE_MS : COMPACTION_TIMEOUT_MS
}

// Only `body` gives way to the budget; `pointer` is where a cut result can be read again whole. The
// tools give way first: a message or an earlier summary has no copy to read again once cut.
type SummaryPiece = { before: string; body: string; after: string; pointer: string; yields: 'tool' | 'text' }

function textPiece(body: string): SummaryPiece {
    return { before: '', body, after: '', pointer: '', yields: 'text' }
}

function pieceOf(part: unknown): SummaryPiece | undefined {
    if (typeof part === 'string') return textPiece(part)
    if (!part || typeof part !== 'object') return undefined
    const p = part as Record<string, unknown>
    // The memories recalled for a turn and its timestamp were context, not conversation.
    if (isContextPart(p)) return undefined
    if (p.type === 'text' && typeof p.text === 'string') return textPiece(p.text)
    if (p.type === 'tool-call') return { before: `→ called ${String(p.toolName)}(`, body: JSON.stringify(p.input ?? {}), after: ')', pointer: '', yields: 'tool' }
    if (p.type === 'tool-result') {
        const output = p.output as { type?: string; value?: unknown } | undefined
        // A result read as text stays text: as JSON every line break of the code it holds turns into `\n`.
        const body = typeof output?.value === 'string' ? output.value : JSON.stringify(output?.value ?? output ?? '')
        return { before: `← ${String(p.toolName)} result: `, body, after: '', pointer: output ? savedPointerOf({ type: output.type ?? 'text', value: output.value }) : '', yields: 'tool' }
    }
    return undefined
}

// The largest length every body can keep so that all of them fit in `budget`: a body under it stays whole.
function bodyCap(lengths: number[], budget: number): number {
    const sorted = [...lengths].sort((a, b) => a - b)
    let left = budget
    for (let i = 0; i < sorted.length; i++) {
        const share = Math.floor(left / (sorted.length - i))
        if (sorted[i] > share) return Math.max(0, share)
        left -= sorted[i]
    }
    return Infinity
}

function cutMarker({ pointer }: SummaryPiece, cutChars: number): string {
    return `\n…[${cutChars} characters cut${pointer}]…\n`
}

// Cutting a body no longer than the note that replaces it would only lengthen it.
function cuttable(piece: SummaryPiece): boolean {
    return piece.body.length > cutMarker(piece, piece.body.length).length
}

function cutBody(piece: SummaryPiece, cap: number): string {
    const { body } = piece
    if (body.length <= cap) return body
    const head = Math.ceil(cap * 0.75)
    return `${body.slice(0, head)}${cutMarker(piece, body.length - cap)}${body.slice(body.length - (cap - head))}`
}

function serializeForSummary(messages: ModelMessage[], budgetChars: number): string {
    const turns = messages.map(message => {
        const content = message.content as unknown
        const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content : []
        return { role: message.role, pieces: parts.map(pieceOf).filter((piece): piece is SummaryPiece => !!piece && !!(piece.before || piece.body)) }
    })
    const pieces = turns.flatMap(turn => turn.pieces)
    // The note of a cut body is held back in advance, at its longest.
    const fixedChars = (piece: SummaryPiece) => piece.before.length + piece.after.length + 1 + (cuttable(piece) ? cutMarker(piece, piece.body.length).length : piece.body.length)
    const frame = turns.reduce((sum, turn) => sum + turn.role.length + 5, 0) + pieces.reduce((sum, piece) => sum + fixedChars(piece), 0)
    const cuttableLengths = (yields: SummaryPiece['yields']) => pieces.filter(piece => piece.yields === yields && cuttable(piece)).map(piece => piece.body.length)
    const room = budgetChars - frame
    const textCap = bodyCap(cuttableLengths('text'), room)
    const textKept = cuttableLengths('text').reduce((sum, length) => sum + Math.min(length, textCap), 0)
    const toolCap = bodyCap(cuttableLengths('tool'), room - textKept)
    const capOf = (piece: SummaryPiece) => (!cuttable(piece) ? Infinity : piece.yields === 'text' ? textCap : toolCap)
    return turns.map(turn => `[${turn.role}]\n${turn.pieces.map(piece => `${piece.before}${cutBody(piece, capOf(piece))}${piece.after}`).join('\n')}`).join('\n\n')
}

// The summary is asked of the run's own model, so what it reads stays under the threshold the run
// is compacted at, with room left for the summary it writes.
function summaryInputBudgetChars(threshold: number): number {
    const tokens = Math.max(threshold / 2, threshold - COMPACTION_SUMMARY_TOKENS_CEILING)
    return Math.floor(tokens * COMPACTION_SUMMARY_INPUT_CHARS_PER_TOKEN) - SUMMARY_SYSTEM.length - SUMMARY_REQUEST.length - '<transcript>\n\n</transcript>\n\n'.length
}

export type CompactionSummary = { text: string; usage: LanguageModelUsage; providerMetadata: unknown; durationMs: number }

export async function summarizeMiddle(ctx: RunContext, override: ModelOverride | undefined, middle: ModelMessage[], threshold: number): Promise<CompactionSummary> {
    const startedAt = Date.now()
    const release = await ensureCliAuth(ctx.agent.resolved.provider, ctx.agent.resolved.connection)
    try {
        const signal = deadlineSignal(summaryTimeoutMs(ctx.provider), ctx.abortSignal)
        const { text, usage, providerMetadata } = await raceAbort(
            generateText({
                model: modelFor(ctx.agent, override, undefined, undefined, { sessionId: ctx.sessionId }),
                system: SUMMARY_SYSTEM,
                prompt: `<transcript>\n${serializeForSummary(middle, summaryInputBudgetChars(threshold))}\n</transcript>\n\n${SUMMARY_REQUEST}`,
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
    if (!text.toLowerCase().includes(SUMMARY_TITLE.toLowerCase())) throw new Error(`the model wrote ${text.length} characters that are not a summary, starting ${JSON.stringify(text.slice(0, 100))}`)
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
    const threshold = compactionThreshold(contextWindow, ctx.provider)
    if (estimateTokens(working, system, toolChars) < threshold) return working

    const offset = priorSummary ? 1 : 0
    const tailStart = tailStartIndex(working, COMPACTION_TAIL_TOKEN_BUDGET)
    const newThroughIndex = tailStart - 1 - offset
    if (newThroughIndex < 0) return working

    const checkpointId = newId()
    ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'running' } })

    try {
        const middle = working.slice(0, tailStart)
        const tail = working.slice(tailStart)
        const summary = await summarizeMiddle(ctx, override, middle, threshold)
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
