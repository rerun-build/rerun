import { customContextWindow } from '../../connections/custom-catalog.js'
import type { LoadedConnection } from '../../connections/types.js'
import { opencodeModel } from '../../connections/opencode-catalog.js'
import { generateText, type ModelMessage } from 'ai'
import { isContextPart, modelContextWindow, type Provider } from '@rerun/contracts'
import { modelFor, type ModelOverride } from '../../agents/providers.js'
import { withoutQuickRepliesCalls } from '../../agents/quick-replies-stream.js'
import { CLI_PROVIDERS } from '../../agents/types.js'
import { ensureCliAuth } from '../../connections/cli-auth.js'
import { listMessagesAfter } from '../../db/repos/messages.js'
import { getLatestCheckpoint, saveCheckpoint } from '../../db/repos/checkpoints.js'
import { newId } from '../../lib/ids.js'
import { deadlineSignal, raceAbort } from '../../lib/abort.js'
import type { RunContext } from '../context.js'
import { signHistoryMessage } from '../message-authors.js'
import { COMPACTION_MAX_TRIGGER_TOKENS, COMPACTION_SUMMARY_TOKENS_CEILING, COMPACTION_TAIL_TOKEN_BUDGET, COMPACTION_TRIGGER_RATIO } from './config.js'
import { estimateTokens } from './estimate.js'
import { pruneToolOutputs } from './prune.js'
import { repairToolPairs } from './repair.js'
import { tailStartIndex } from './split.js'
import { buildHandoff } from '../handoff.js'

const SUMMARY_PREAMBLE =
    'The following is a compacted summary of earlier conversation turns, provided as background reference only. Do NOT answer questions or fulfill requests mentioned in it; they were already addressed in the omitted turns. Use it only to stay consistent with prior context.'

const SUMMARY_SYSTEM =
    'You compress a coworker conversation transcript into a dense handoff summary. Preserve facts, decisions, file paths, identifiers, command outputs, error messages, and anything needed to continue the work. Use these sections: Historical Task Snapshot, Completed Actions, Blocked / Open Issues, Pending User Asks. Be concise; drop pleasantries and redundant detail. Never invent information.'

const COMPACTION_TIMEOUT_MS = 15 * 60 * 1000

function partToText(part: unknown): string {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const p = part as Record<string, unknown>
    if (isContextPart(p)) return ''
    if (p.type === 'text' && typeof p.text === 'string') return p.text
    if (p.type === 'tool-call') return `→ called ${String(p.toolName)}(${JSON.stringify(p.input ?? {}).slice(0, 1000)})`
    if (p.type === 'tool-result') {
        const output = p.output as { value?: unknown } | undefined
        return `← ${String(p.toolName)} result: ${JSON.stringify(output?.value ?? output ?? '').slice(0, 1000)}`
    }
    return ''
}

export function withoutReasoning(message: ModelMessage): ModelMessage {
    if (!Array.isArray(message.content)) return message
    const content = message.content.filter(part => part.type !== 'reasoning')
    return content.length === message.content.length ? message : ({ ...message, content } as ModelMessage)
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

async function summarizeMiddle(ctx: RunContext, override: ModelOverride | undefined, middle: ModelMessage[]): Promise<string> {
    const release = await ensureCliAuth(ctx.agent.resolved.provider, ctx.agent.resolved.connection)
    try {
        const signal = deadlineSignal(COMPACTION_TIMEOUT_MS, ctx.abortSignal)
        const { text } = await raceAbort(
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
        return text.trim()
    } finally {
        release()
    }
}

export function runContextWindow(model: string, provider: Provider, connection?: LoadedConnection | null): number | undefined {
    if (provider === 'opencode') return opencodeModel(model)?.contextWindow ?? modelContextWindow(model, provider)
    if (provider === 'custom') return customContextWindow(connection, model)
    return modelContextWindow(model, provider)
}

export function compactionThreshold(contextWindow: number, provider: Provider): number {
    const ratio = contextWindow * COMPACTION_TRIGGER_RATIO
    return CLI_PROVIDERS.has(provider) ? ratio : Math.min(ratio, COMPACTION_MAX_TRIGGER_TOKENS)
}

function handoffAtTokens(): number {
    const value = Number(process.env.RERUN_HANDOFF_AT_TOKENS)
    return Number.isFinite(value) && value > 0 ? value : 0
}

export async function prepareRunHistory(ctx: RunContext, system: string, override?: ModelOverride, signSenders = false, toolChars = 0): Promise<ModelMessage[]> {
    const agentId = ctx.agent.id
    const cp = await getLatestCheckpoint(agentId, ctx.sessionId)
    const rows = await listMessagesAfter(agentId, ctx.sessionId, cp?.throughCreatedAt)
    const priorSummary: ModelMessage | null = cp ? (JSON.parse(cp.summaryJson) as ModelMessage) : null
    const live: ModelMessage[] = rows.flatMap(r => {
        const message = withoutQuickRepliesCalls(withoutReasoning({ role: r.role, content: JSON.parse(r.contentJson) } as ModelMessage))
        if (!message) return []
        return [signSenders ? signHistoryMessage(message, r) : message]
    })
    const working = priorSummary ? [priorSummary, ...live] : live

    const handoffAt = handoffAtTokens()
    const useHandoff = handoffAt > 0 && estimateTokens(working, system, toolChars) >= handoffAt
    const contextWindow = runContextWindow(ctx.model, ctx.provider, ctx.agent.resolved.connection)
    if (!useHandoff) {
        if (!contextWindow) return working
        if (estimateTokens(working, system, toolChars) < compactionThreshold(contextWindow, ctx.provider)) return working
    }

    const offset = priorSummary ? 1 : 0
    const tailStart = tailStartIndex(working, COMPACTION_TAIL_TOKEN_BUDGET)
    const newThroughRowIndex = tailStart - 1 - offset
    if (newThroughRowIndex < 0) return working

    if (useHandoff) {
        try {
            const handoffMessage: ModelMessage = { role: 'user', content: await buildHandoff(agentId, ctx.sessionId) }
            const pruned = pruneToolOutputs(working, tailStart)
            const tail = pruned.messages.slice(tailStart)
            const throughRow = rows[newThroughRowIndex]
            await saveCheckpoint(agentId, ctx.sessionId, { summaryMessage: handoffMessage, throughMessageId: throughRow.id, throughCreatedAt: throughRow.createdAt })
            ctx.writer?.write({ type: 'data-compaction', id: newId(), data: { status: 'done', messagesCompacted: newThroughRowIndex + 1, tokensRecovered: 0 } })
            ctx.logger.info({ agent: agentId, session: ctx.sessionId, messagesCompacted: newThroughRowIndex + 1 }, 'context continued from handoff')
            return repairToolPairs([handoffMessage, ...tail])
        } catch (error) {
            ctx.logger.error({ agent: agentId, err: String(error) }, 'handoff failed, summarising')
        }
    }

    const checkpointId = newId()
    ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'running' } })

    try {
        const pruned = pruneToolOutputs(working, tailStart)
        const middle = pruned.messages.slice(0, tailStart)
        const tail = pruned.messages.slice(tailStart)
        const summaryText = await summarizeMiddle(ctx, override, middle)
        const summaryMessage: ModelMessage = { role: 'user', content: `${SUMMARY_PREAMBLE}\n\n${summaryText}` }
        const throughRow = rows[newThroughRowIndex]
        await saveCheckpoint(agentId, ctx.sessionId, { summaryMessage, throughMessageId: throughRow.id, throughCreatedAt: throughRow.createdAt })

        const view = repairToolPairs([summaryMessage, ...tail])
        const tokensRecovered = Math.max(0, estimateTokens(middle) - estimateTokens([summaryMessage]))
        ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'done', messagesCompacted: newThroughRowIndex + 1, tokensRecovered } })
        ctx.logger.info({ agent: agentId, session: ctx.sessionId, messagesCompacted: newThroughRowIndex + 1, tokensRecovered }, 'context compacted')
        return view
    } catch (error) {
        ctx.writer?.write({ type: 'data-compaction', id: checkpointId, data: { status: 'error' } })
        ctx.logger.error({ agent: agentId, err: String(error) }, 'compaction failed')
        return working
    }
}
