import { streamText, wrapLanguageModel, type LanguageModelUsage, type ModelMessage, type StreamTextResult, type ToolSet, type UIMessageStreamWriter } from 'ai'
import { RERUN_CONNECTION_ID, contextTextPart, pendingComputerAccess, providerSwitchEntry, type ContextOccupancy, type MessageAuthor, type ProviderSwitch } from '@rerun/contracts'
import { applyCaching, withTailBreakpoint } from '../agents/caching.js'
import { effortProviderOptions, mergeProviderOptions, reasoningProviderOptions, runEffort } from '../agents/reasoning.js'
import { prepareRunHistory } from './compaction/compact.js'
import { createInRunCompactor } from './compaction/in-run.js'
import { repairToolPairs, withToolResultsInToolMessages } from './compaction/repair.js'
import { approvalSummary, canonicalHitlName, findPendingHitl, hitlStepLacksMessage, hitlTurnIsOver, isHitlToolName, secretSummary, takeoverSummary, type PendingHitl } from '../tools/builtin/hitl.js'
import { CLI_PROVIDERS, resolveModel, type ModelOverride } from '../agents/providers.js'
import type { ClaudeCompaction } from '../agents/claude-context.js'
import { offersQuickReplies, quickRepliesCall, type QuickRepliesCapture } from '../agents/quick-replies-stream.js'
import { codexThreadToResume, forgetCodexThread, rememberCodexThread } from '../agents/codex-threads.js'
import { repairBoxDefault, toOverride, type RunModel } from '../agents/availability.js'
import { hasBackups, limitReached, pickBackup, servedRunModel, switchOpeningTurn } from '../agents/backups.js'
import { claudeTokenOf, claudeTokenOutlived } from '../connections/claude-token.js'
import { ensureCliAuth } from '../connections/cli-auth.js'
import { syncCodexAuth } from '../connections/codex-auth.js'
import { forgetCredentialRejected, recordCredentialRejected } from '../connections/credential-rejections.js'
import { recordRefusedModel } from '../connections/cli-models.js'
import { refreshCodexPlanLimits } from '../connections/codex-plan-limits.js'
import { armPlanLimitLatch, clearPlanLimitLatch } from '../connections/plan-limits.js'
import { refreshOpencodePlanLimits } from '../connections/opencode-plan-limits.js'
import { refreshClaudePlanLimitsAfterRun } from '../connections/claude-plan-limits.js'
import { behaviourOf } from '../agents/opencode.js'
import { buildSystemPrompt, calledByBlock, nowBlock, recallMemories, recallSection, systemPromptText, relayedBlock, userBlock, userLanguageBlock } from '../agents/systemPrompt.js'
import type { LoadedAgent } from '../agents/types.js'
import { turnOrder } from '../agents/turn-order.js'
import { answeringModel } from '../agents/rerun-upstream.js'
import { listAgentIndex, setAgentStatus } from '../db/repos/agents.js'
import { appendMessage, lastMessageId, lastProviderSwitch, listSessionAuthorIds, setMessageToolCalls } from '../db/repos/messages.js'
import type { MessageRow } from '../db/schema.js'
import { isSharedConversation, signText } from './message-authors.js'
import { bumpRunStep, cancelRun, failRun, finishRun, setRunContext, startRun } from '../db/repos/runs.js'
import { insertRunStep, insertToolCall } from '../db/repos/telemetry.js'
import { touchSession } from '../db/repos/sessions.js'
import { logger } from '../lib/logger.js'
import { newId, nowIso } from '../lib/ids.js'
import { buildTools } from '../tools/registry.js'
import { callTargetsOf, withForeman } from '../tools/builtin/call-agent.js'
import { toolPayloadChars } from '../tools/payload.js'
import { sentToolNames } from '../tools/mcp-search.js'
import { mcpWireMiddleware } from '../tools/mcp-wire.js'
import { prepareMcpServer } from '../tools/mcp.js'
import { withPooledRelays } from '../tools/mcp-relay.js'
import { HostBreaker } from '../tools/host-breaker.js'
import { offersTeamRequests, runsReadOnly, runsUnattended, type PartialResult, type RunContext, type RunTrigger, type SkillProposalNotice } from './context.js'
import { partialResultsNote } from './partial-results.js'
import { stoppedTurn } from './stopped-turn.js'
import { streamedTurn } from './streamed-turn.js'
import { registerRunAbort, setRunCancel, unregisterRunAbort } from './run-control.js'
import { runCurator } from './curator.js'
import { repairToolCall } from './tool-repair.js'
import { stepWithScreenshots } from './screenshots.js'
import { costMicrosFrom } from './step-cost.js'
import { authorMetadata, sendNotification, type NotificationKind } from './notify.js'
import { emitRunTerminal } from './run-events.js'
import { chatGptWorkspaceError, ClaudeSignInRenewedError, classifyFinishReason, classifyProviderError, errorMessageOf, isFailedFinish, openAiCreditsError, ProviderRefusedError, ProviderStreamCutError, RUN_ERROR_CODES, refusalReason, unreachableEndpointError, type RunErrorCode } from './provider-errors.js'
import { armBudgetLatch, clearBudgetLatch, RERUN_BUDGET_ERROR_CODE } from './budget-latch.js'
import { agentMcpServers } from '../vault/runtime.js'

// `awaitingHuman`: the turn ended on a card (a question, an approval) and the work it was for has
// not happened yet.
export type RunOutcome = { kind: 'done' | 'error' | 'cancelled'; error?: string; errorCode?: RunErrorCode | null; awaitingHuman?: boolean }

// How one provider's go at a turn ended. A turn whose subscription ran out mid-way is handed to a
// backup: the same run carries on as `next`, on another provider, in the same stream.
export type AttemptOutcome = RunOutcome | { kind: 'handover'; next: AgentRun }

export type AgentRun = {
    result: StreamTextResult<ToolSet, never>
    runId: string
    // Always resolves, exactly once, whatever the provider does, with how the whole run ended once
    // every backup it was handed to is done. Callers that need to know a run is over must await
    // this rather than `result.finishReason`, which never settles when a stream hangs.
    settled: Promise<RunOutcome>
    attempt: Promise<AttemptOutcome>
    provider: string
    model: string
    // The line the chat shows before this attempt's answer, when it runs on another model than the
    // conversation's last one.
    providerSwitch?: ProviderSwitch
    contextUsage?: () => ContextOccupancy | undefined
    quickReplies?: () => QuickRepliesCapture | undefined
}

// What a backup takes over from the attempt that hit the limit: the run's abort controller and
// session claim, the subscriptions already tried, and the switch lines not yet stored with a message.
type Handover = { controller: AbortController; tried: Set<string>; to: RunModel; change: ProviderSwitch; unstored: ProviderSwitch[]; steps: number }

const CONTINUE_AFTER_SWITCH = 'The previous model stopped partway through this turn. Continue from where it left off.'

// The turn is already stored and ends the history, unless the model that ran out had started to
// answer: a turn has to end on the user's side, so a note asks the backup to carry on.
function continuationTurn(history: ModelMessage[]): ModelMessage[] {
    if (history.at(-1)?.role === 'user') return history
    return [...history, { role: 'user', content: [contextTextPart(CONTINUE_AFTER_SWITCH)] }]
}

export type { RunTrigger }

// A provider teardown that hangs must not hold the run open: the row, the hub event and the session
// claim all matter more than a clean CLI exit.
const CLOSE_TIMEOUT_MS = 15_000

function canonicalizeHitlNames(messages: ModelMessage[]): ModelMessage[] {
    return messages.map(m => {
        if (!Array.isArray(m.content)) return m
        let changed = false
        const content = m.content.map(part => {
            const p = part as { type?: string; toolName?: string }
            if ((p.type === 'tool-call' || p.type === 'tool-result') && isHitlToolName(p.toolName) && p.toolName !== canonicalHitlName(p.toolName)) {
                changed = true
                return { ...part, toolName: canonicalHitlName(p.toolName) }
            }
            return part
        })
        return changed ? ({ ...m, content } as ModelMessage) : m
    })
}

function coerceJsonArray(value: unknown): unknown {
    if (typeof value !== 'string') return value
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

function questionSummary(input: Record<string, unknown> | undefined): string {
    const questions = coerceJsonArray(input?.questions) as Array<{ question?: unknown }> | undefined
    if (Array.isArray(questions) && questions.length > 0) {
        const first = String(questions[0]?.question ?? 'The coworker has a question')
        return questions.length > 1 ? `${first} (+${questions.length - 1} more)` : first
    }
    return String(input?.question ?? 'The coworker has a question')
}

function serviceSummary(input: Record<string, unknown> | undefined): string {
    const services = coerceJsonArray(input?.services) as Array<{ slug?: unknown }> | undefined
    if (Array.isArray(services) && services.length > 0) {
        const first = String(services[0]?.slug ?? 'an app')
        return services.length > 1 ? `Set up ${first} (+${services.length - 1} more)` : `Set up ${first}`
    }
    return 'Set up an app'
}

function computerAccessSummary(input: Record<string, unknown> | undefined): string {
    const { computer, commands } = pendingComputerAccess(input ?? {})
    const first = commands[0]
    if (!first) return `Wants to use #${computer}`
    const shown = first.length > 80 ? `${first.slice(0, 80)}…` : first
    return commands.length > 1 ? `Run on #${computer}: ${shown} (+${commands.length - 1} more)` : `Run on #${computer}: ${shown}`
}

function hitlKind(toolName: string): NotificationKind {
    if (toolName === 'ask_user') return 'question'
    // A secret request is a connector to finish setting up, from the user's point of view.
    if (toolName === 'suggest_service' || toolName === 'request_secret' || toolName === 'request_mcp_sign_in') return 'connector'
    return 'approval'
}

function hitlMessage(toolName: string, input: Record<string, unknown> | undefined): string {
    if (toolName === 'ask_user') return questionSummary(input)
    if (toolName === 'suggest_service') return serviceSummary(input)
    if (toolName === 'request_secret') return secretSummary(input)
    if (toolName === 'request_mcp_sign_in') return `Sign in to ${String(input?.name ?? 'an MCP server')}`
    if (toolName === 'request_takeover') return takeoverSummary(input)
    if (toolName === 'request_spend') return typeof input?.purpose === 'string' && input.purpose.trim() ? input.purpose : 'Approve a paid data spend'
    if (toolName === 'request_computer_access') return computerAccessSummary(input)
    if (toolName === 'request_feature') return typeof input?.title === 'string' && input.title.trim() ? `Send to the Rerun team: ${input.title.trim()}` : 'Send a request to the Rerun team'
    return approvalSummary(input)
}

async function emitHitlEvent(agent: LoadedAgent, sessionId: string, runId: string, pending: PendingHitl, author: MessageAuthor | undefined): Promise<void> {
    const kind = hitlKind(pending.toolName)
    const input = pending.input as Record<string, unknown> | undefined
    const message = hitlMessage(pending.toolName, input)
    await sendNotification({ event: 'agent.notification', kind, agentId: agent.id, sessionId, runId, message, metadata: { toolCallId: pending.toolCallId, toolName: pending.toolName, input: pending.input, ...authorMetadata(author) } }).catch(() => {})
}

// The proposal never pauses the run, so it is announced after the terminal event: sent first, the
// run's `done` would put the conversation back to idle right behind it.
async function emitSkillProposalEvent(agent: LoadedAgent, sessionId: string, runId: string, notice: SkillProposalNotice, author: MessageAuthor | undefined): Promise<void> {
    const message = notice.mode === 'edit' ? `Wants to update a skill: ${notice.title}` : `Wants to save a new skill: ${notice.title}`
    await sendNotification({ event: 'agent.notification', kind: 'approval', agentId: agent.id, sessionId, runId, message, metadata: { toolName: 'skill_propose', proposalId: notice.proposalId, ...authorMetadata(author) } }).catch(() => {})
}

function safeJson(value: unknown): string | null {
    if (value === undefined) return null
    try {
        return JSON.stringify(value)
    } catch {
        return null
    }
}

type StepLike = {
    finishReason?: string
    text?: string
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number; inputTokenDetails?: { cacheWriteTokens?: number } }
    providerMetadata?: unknown
    toolCalls?: Array<{ toolCallId?: string; toolName: string; input?: unknown }>
    toolResults?: Array<{ toolCallId?: string; output?: unknown }>
}

async function recordStepTelemetry(agentId: string, sessionId: string, runId: string, provider: string, model: string, stepNumber: number, durationMs: number, step: StepLike, costMicros: number | null): Promise<void> {
    const calls = step.toolCalls ?? []
    const results = step.toolResults ?? []
    await insertRunStep(agentId, {
        id: newId(),
        runId,
        agentId,
        sessionId,
        stepNumber,
        provider,
        model,
        finishReason: step.finishReason ?? null,
        inputTokens: step.usage?.inputTokens ?? null,
        outputTokens: step.usage?.outputTokens ?? null,
        cachedInputTokens: step.usage?.cachedInputTokens ?? null,
        reasoningTokens: step.usage?.reasoningTokens ?? null,
        totalTokens: step.usage?.totalTokens ?? null,
        cacheWriteTokens: step.usage?.inputTokenDetails?.cacheWriteTokens ?? null,
        costMicros,
        toolCallCount: calls.length,
        textLength: step.text?.length ?? 0,
        durationMs,
        createdAt: nowIso(),
    })
    for (const call of calls) {
        const result = results.find(r => r.toolCallId === call.toolCallId)
        await insertToolCall(agentId, {
            id: newId(),
            runId,
            agentId,
            sessionId,
            stepNumber,
            toolCallId: call.toolCallId ?? null,
            toolName: call.toolName,
            inputJson: safeJson(call.input),
            resultJson: result ? safeJson(result.output) : null,
            isError: result ? 0 : 1,
            durationMs: null,
            createdAt: nowIso(),
        })
    }
}

export async function runAgent(agent: LoadedAgent, sessionId: string, userText: string, override?: ModelOverride, writer?: UIMessageStreamWriter, runId?: string, trigger: RunTrigger = { source: 'chat' }): Promise<AgentRun> {
    return runTurn(agent, sessionId, userText, override, writer, runId, trigger, undefined)
}

// How a turn ends. Everything terminal about a run is expressed as one of these three and handed to
// `settle`, which is the single place that writes the row, frees the session and tells the hub.
type Settlement =
    | { kind: 'done'; text: string; usage: LanguageModelUsage | undefined; costMicros: number | null; messages: ModelMessage[] }
    | { kind: 'error'; error: unknown; errorCode?: RunErrorCode | null; messages?: ModelMessage[] }
    | { kind: 'cancelled' }

async function runTurn(baseAgent: LoadedAgent, sessionId: string, userText: string, override: ModelOverride | undefined, writer: UIMessageStreamWriter | undefined, runId: string | undefined, trigger: RunTrigger, handover: Handover | undefined): Promise<AgentRun> {
    // The run row and its abort controller exist before any preparation step can throw: for chat
    // and headless callers the row was already inserted, and a throw in `resolveRunModel` or the
    // tool/MCP setup would otherwise leave it `running` forever with no terminal event for the hub.
    const startedAt = Date.now()
    const run = runId ? { id: runId } : await startRun(baseAgent.id, sessionId)
    const controller = handover?.controller ?? registerRunAbort(run.id, baseAgent.id)
    // Its own signal rather than the run's: a turn handed over to a backup goes on in the same run.
    const attempt = new AbortController()
    const attemptSignal = AbortSignal.any([controller.signal, attempt.signal])
    const author = trigger.source === 'chat' ? trigger.author : undefined
    const readOnly = runsReadOnly(trigger)
    const tried = handover?.tried ?? new Set<string>()

    let agent = baseAgent
    let runOverride = handover ? toOverride(handover.to) : override
    let { connection, provider, model } = handover?.to ?? baseAgent.resolved
    let providerSwitch: ProviderSwitch | undefined = handover?.change
    const unstoredSwitches = [...(handover?.unstored ?? []), ...(handover ? [handover.change] : [])]
    let closeTools = async (): Promise<void> => {}
    let closeModel = async (): Promise<void> => {}
    let appendP: Promise<unknown> = Promise.resolve()
    let contextUsage: (() => ContextOccupancy | undefined) | undefined
    let quickReplies: (() => QuickRepliesCapture | undefined) | undefined
    let cliAuthP: Promise<() => void> | undefined
    let spawnToken: string | undefined
    let codexThreadId: string | undefined
    let steps = handover?.steps ?? 0
    const partialResults: PartialResult[] = []
    const skillProposals: SkillProposalNotice[] = []
    const streamed = streamedTurn()

    // The CLI process owns the bridged MCP server that calls back into `tools`, so it goes down
    // first. Codex's own token refresh only lands in auth.json once it has exited, hence the sync
    // last. Every teardown path below funnels through this.
    const close = async (): Promise<void> => {
        await closeModel().catch(err => logger.warn({ err: String(err), agent: agent.id }, 'close model failed'))
        await closeTools().catch(err => logger.warn({ err: String(err), agent: agent.id }, 'close tools failed'))
        if (provider === 'codex') {
            await syncCodexAuth(connection).catch(() => {})
            void refreshCodexPlanLimits(connection)
        }
        if (provider === 'opencode') void refreshOpencodePlanLimits(connection)
        if (provider === 'claude') refreshClaudePlanLimitsAfterRun(connection, startedAt)
    }

    const closeSafely = async (): Promise<boolean> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const guard = new Promise<false>(resolve => {
            timer = setTimeout(() => {
                logger.warn({ agent: agent.id, run: run.id, provider }, 'run teardown timed out')
                resolve(false)
            }, CLOSE_TIMEOUT_MS)
        })
        const closedInTime = await Promise.race([close().then(() => true, () => true), guard])
        if (timer) clearTimeout(timer)
        return closedInTime
    }

    let settled = false
    let resolveSettled!: (outcome: AttemptOutcome) => void
    const settledPromise = new Promise<AttemptOutcome>(resolve => {
        resolveSettled = resolve
    })

    let resolveStored!: () => void
    const storedPromise = new Promise<void>(resolve => {
        resolveStored = resolve
    })

    const storeMessages = async (messages: ModelMessage[]): Promise<MessageRow[]> => {
        const rows: MessageRow[] = []
        for (const message of messages) {
            const row = await appendMessage(agent.id, sessionId, message).catch(() => undefined)
            if (row) rows.push(row)
        }
        return rows
    }

    // Each switch line this attempt opened with sits beside its first answer, where a reload puts it
    // back. With nothing written, they wait for the next message the run stores.
    const storeSwitches = async (rows: MessageRow[]): Promise<Map<string, unknown[]>> => {
        const sidecar = new Map<string, unknown[]>()
        const first = rows.find(row => row.role === 'assistant')
        if (first && unstoredSwitches.length) sidecar.set(first.id, unstoredSwitches.splice(0).map(providerSwitchEntry))
        return sidecar
    }
    const writeSidecar = async (sidecar: Map<string, unknown[]>): Promise<void> => {
        for (const [rowId, calls] of sidecar) await setMessageToolCalls(agent.id, rowId, calls).catch(() => {})
    }

    // The subscription is out and a backup is free: the run goes on there instead of failing. The
    // session stays claimed and the run stays open, so nothing can slip in between the two.
    const handOver = async (to: RunModel): Promise<AttemptOutcome> => {
        resolveStored()
        if (!(await closeSafely()) && provider === 'codex') forgetCodexThread(agent.id, sessionId)
        void cliAuthP?.then(release => release(), () => {})
        const from = { connection, provider, model }
        const change = limitReached(from, to)
        logger.warn({ agent: agent.id, run: run.id, from: `${connection?.id}:${model}`, to: `${to.connection?.id}:${to.model}` }, 'subscription limit reached, handing the turn to a backup')
        let outcome: AttemptOutcome
        try {
            const next = await runTurn(baseAgent, sessionId, userText, override, writer, run.id, trigger, { controller, tried, to, change, unstored: unstoredSwitches, steps })
            outcome = { kind: 'handover', next }
        } catch (err) {
            // The backup's own preparation failed and already closed the run, row and event included.
            outcome = { kind: 'error', error: errorMessageOf(err), errorCode: null }
        }
        resolveSettled(outcome)
        return outcome
    }

    const endRun = async (settlement: Settlement): Promise<AttemptOutcome> => {
        await appendP.catch(() => {})

        let outcome: RunOutcome
        let pending: PendingHitl | null = null
        let text: string | undefined
        let usage: LanguageModelUsage | undefined
        let costMicros: number | null = null

        if (settlement.kind === 'done') {
            const messages = canonicalizeHitlNames(settlement.messages)
            const rows = await storeMessages(messages)
            const answerRow = rows.findLast(row => row.role === 'assistant')
            pending = findPendingHitl(messages)
            const sidecar = await storeSwitches(rows)
            // A turn that ends on a card ignores the replies: the card already says how to answer.
            const replies = quickReplies?.()
            if (replies && answerRow && !pending) sidecar.set(answerRow.id, [...(sidecar.get(answerRow.id) ?? []), quickRepliesCall(replies)])
            await writeSidecar(sidecar)
            if (provider === 'rerun') clearBudgetLatch()
            // A check-in's thread holds its read-only prompt: a reply in the thread it opened starts
            // a new one, on the chat's brief.
            if (provider === 'codex') await (readOnly ? Promise.resolve(forgetCodexThread(agent.id, sessionId)) : keepCodexThread()).catch(() => forgetCodexThread(agent.id, sessionId))
            await finishRun(agent.id, run.id, settlement.usage, steps, settlement.costMicros, contextUsage?.()).catch(() => {})
            await touchSession(agent.id, sessionId).catch(() => {})
            text = settlement.text
            usage = settlement.usage
            costMicros = settlement.costMicros
            if (connection) {
                forgetCredentialRejected(connection.id)
                clearPlanLimitLatch(connection.id)
            }
            outcome = pending ? { kind: 'done', awaitingHuman: true } : { kind: 'done' }
        } else if (settlement.kind === 'cancelled') {
            forgetCodexThread(agent.id, sessionId)
            const stoppedBy = trigger.source === 'chat' && trigger.calledBy !== undefined ? 'the user or the calling coworker' : 'the user'
            await writeSidecar(await storeSwitches(await storeMessages(stoppedTurn(streamed.messages(), stoppedBy))))
            if (partialResults.length) await appendMessage(agent.id, sessionId, { role: 'assistant', content: partialResultsNote(partialResults) }).catch(() => {})
            await cancelRun(agent.id, run.id).catch(() => {})
            outcome = { kind: 'cancelled' }
        } else {
            const renewed = settlement.errorCode === RUN_ERROR_CODES.unauthorized && provider === 'claude' && claudeTokenOutlived(connection, spawnToken)
            if (renewed) settlement = { ...settlement, error: new ClaudeSignInRenewedError(), errorCode: RUN_ERROR_CODES.authRenewed }
            if (settlement.errorCode === RUN_ERROR_CODES.refused) settlement = { ...settlement, error: new ProviderRefusedError(refusalReason(settlement.error)) }
            const unreachable = provider === 'custom' ? unreachableEndpointError(connection?.config.baseUrl, settlement.error) : null
            if (unreachable) settlement = { ...settlement, error: unreachable }
            const outOfCredits = settlement.errorCode === RUN_ERROR_CODES.usageLimit ? (openAiCreditsError(provider, settlement.error) ?? chatGptWorkspaceError(provider, settlement.error)) : null
            if (outOfCredits) settlement = { ...settlement, error: outOfCredits }
            const errorCode = settlement.errorCode ?? null
            const errorMessage = errorMessageOf(settlement.error)
            forgetCodexThread(agent.id, sessionId)
            logger.error({ err: errorMessage, errorCode, agent: agent.id, run: run.id }, 'run error')
            if (errorCode === RERUN_BUDGET_ERROR_CODE) armBudgetLatch()
            if (errorCode === RUN_ERROR_CODES.usageLimit && connection && connection.id !== RERUN_CONNECTION_ID) armPlanLimitLatch(connection.id)
            // The token is still on file, so the connection would keep reading "Ready" while every
            // run on it fails. The keyless Rerun connection answers for the hub's key, not the user's.
            if (errorCode === RUN_ERROR_CODES.unauthorized && connection && connection.id !== RERUN_CONNECTION_ID) recordCredentialRejected(connection.id)
            // Codex's answer to a real request outranks the list it gave: the model is greyed out from now
            // on, and a box default naming it moves to one the account serves.
            if (errorCode === RUN_ERROR_CODES.modelNotInPlan && provider === 'codex' && connection) {
                const refusedOn = connection
                recordRefusedModel(refusedOn.id, model)
                await repairBoxDefault(refusedOn).catch(err => logger.warn({ err: String(err), connection: refusedOn.id }, 'box default repair failed'))
            }
            // A turn that failed mid-flight still said things worth keeping; without this the user
            // loses everything the agent had already produced.
            await writeSidecar(await storeSwitches(await storeMessages(canonicalizeHitlNames(settlement.messages ?? []))))
            const backup = errorCode === RUN_ERROR_CODES.usageLimit && connection && !controller.signal.aborted ? await pickBackup(tried) : null
            if (backup) return handOver(backup)
            await failRun(agent.id, run.id, errorMessage).catch(() => {})
            outcome = { kind: 'error', error: errorMessage, errorCode }
        }
        resolveStored()

        await setAgentStatus(agent.id, 'idle').catch(() => {})
        // Codex only writes its rotated token to auth.json once the CLI has exited, so the next run
        // must not be able to start before this returns. Capped rather than awaited outright: a
        // teardown that hangs used to be enough to keep the whole conversation busy forever.
        // An app-server still up holds its thread's writer lock: resuming it would be refused.
        if (!(await closeSafely()) && provider === 'codex') forgetCodexThread(agent.id, sessionId)
        void cliAuthP?.then(release => release(), () => {})
        // Last, not first: freeing the session claim before the transcript is written and before
        // the provider is down let a second send in on a history missing this turn.
        unregisterRunAbort(run.id)
        resolveSettled(outcome)

        if (pending) {
            // A run waiting on a human stays "awaiting" only because no terminal event is sent.
            await emitHitlEvent(agent, sessionId, run.id, pending, author)
        } else {
            await emitRunTerminal({
                agentId: agent.id,
                sessionId,
                runId: run.id,
                trigger,
                kind: outcome.kind === 'error' ? 'error' : 'done',
                cancelled: outcome.kind === 'cancelled',
                text,
                error: outcome.error,
                errorCode: outcome.errorCode,
                usage,
                stepCount: steps,
                provider,
                model,
                costMicros,
            })
            const proposed = skillProposals.at(-1)
            if (outcome.kind === 'done' && proposed) await emitSkillProposalEvent(agent, sessionId, run.id, proposed, author)
        }

        if (outcome.kind === 'done' && !pending && agent.config.selfImprovement.enabled && userText && !readOnly) {
            void runCurator(agent, sessionId, userText, text ?? '', runOverride).catch(e => logger.warn({ err: String(e) }, 'curator failed'))
        }

        return outcome
    }

    // The one and only terminal path of a run. `streamText` gives no guarantee that `onFinish` or
    // `onError` is ever called -- a CLI provider that wedges on an expired token simply stops
    // streaming -- so every way a turn can end funnels here, and the guard makes a second arrival
    // a no-op instead of a duplicate row write and a duplicate hub event.
    const settle = async (settlement: Settlement): Promise<AttemptOutcome> => {
        if (settled) return settledPromise
        settled = true
        // An error part does not end `streamText`: it would go on calling the model and the tools of a
        // run Stop no longer reaches.
        if (settlement.kind === 'error') attempt.abort()
        // Stop waits on the transcript: an end that fails on the way must still let it through.
        return endRun(settlement).finally(resolveStored)
    }

    // A subscription already out sends the turn straight to a backup, and the conversation says so
    // once; a turn served again by the subscription it had left says it is back.
    const servedOpening = async (): Promise<RunModel> => {
        const { served, asked, askedOut } = await servedRunModel(baseAgent, override)
        if (served !== asked) runOverride = toOverride(served)
        if (served !== asked || (await hasBackups())) {
            const last = await lastProviderSwitch(baseAgent.id, sessionId).catch(() => null)
            providerSwitch = switchOpeningTurn(asked, served, last, askedOut)
            if (providerSwitch) unstoredSwitches.push(providerSwitch)
        }
        return served
    }

    // The thread is only worth resuming once it holds the same turns as the session: the marker is
    // the last message written, so anything appended after this turn sends the next one to a new thread.
    const keepCodexThread = async (): Promise<void> => {
        const throughMessageId = codexThreadId ? await lastMessageId(agent.id, sessionId) : undefined
        if (!codexThreadId || !throughMessageId) return forgetCodexThread(agent.id, sessionId)
        rememberCodexThread(agent.id, sessionId, { threadId: codexThreadId, connectionId: connection?.id ?? RERUN_CONNECTION_ID, throughMessageId })
    }

    // Stop has to be able to end a run the provider refuses to end: codex ignores the abort signal
    // until its turn has started, which is exactly the state an expired token leaves it in.
    setRunCancel(run.id, () => {
        void settle({ kind: 'cancelled' }).catch(err => logger.warn({ err: String(err), agent: agent.id, run: run.id }, 'run cancel failed'))
        return storedPromise
    })

    try {
        // The recall waits on the hub's embedding: it runs alongside the whole preparation rather
        // than after it. It never rejects, a failed search only means no memories this turn.
        // A backup carrying on a turn finds it stored already, recalled memories included.
        const memoriesP = handover ? Promise.resolve([]) : recallMemories(baseAgent, userText)
        // An override can name a different box connection than the agent's default, so the run works
        // off a view of the agent bound to the connection it will actually bill. The connection object
        // itself stays the shared instance, so a token refreshed here is refreshed for everyone.
        const resolved = handover ? handover.to : await servedOpening()
        agent = resolved === baseAgent.resolved ? baseAgent : { ...baseAgent, resolved }
        ;({ connection, provider, model } = resolved)
        if (connection) tried.add(connection.id)
        const t0 = Date.now()
        const order = turnOrder(provider, await answeringModel(provider, model))
        const callableAgentIds = trigger.source === 'chat' ? trigger.callableAgentIds : undefined
        const effort = runEffort(baseAgent, runOverride, provider, model)
        const ctx: RunContext = { agent, sessionId, logger, provider, model, effort, turnOrder: order, author, writer, abortSignal: attemptSignal, callTargets: [], callableAgentIds, hostBreaker: new HostBreaker(), partialResults, skillProposals, unattended: runsUnattended(trigger), readOnly, called: trigger.source === 'chat' && trigger.calledBy !== undefined, teamRequests: offersTeamRequests(trigger) }

        ctx.runId = run.id
        const triggerSlug = 'slug' in trigger ? trigger.slug : null
        void setRunContext(agent.id, run.id, { provider, model, triggerSource: trigger.source, triggerSlug }).catch(() => {})

        const callTargetsP = agent.config.tools.callAgent ? listAgentIndex().then(idx => callTargetsOf(withForeman(idx), agent.id, callableAgentIds)) : Promise.resolve([])
        const toolsP = callTargetsP.then(callTargets => {
            ctx.callTargets = callTargets
            return buildTools(ctx)
        })
        // A check-in hands a CLI none of the servers it would start on its own: only the bridged tools.
        const preparedP = CLI_PROVIDERS.has(provider) && !readOnly ? Promise.all(agentMcpServers(agent).map(s => prepareMcpServer(agent.id, s, agent.env, agent.hubAgentId))) : Promise.resolve([])
        // Claude reaches its servers through the engine's connections; Codex starts its own without
        // holding up the model, so it keeps dialing them as declared.
        const mcpServersP = provider === 'claude' ? preparedP.then(servers => withPooledRelays(agent, servers)) : preparedP
        cliAuthP = ensureCliAuth(provider, connection)

        void setAgentStatus(agent.id, 'busy').catch(err => logger.warn({ err: String(err), agent: agent.id }, 'setAgentStatus busy failed'))

        const system = await buildSystemPrompt(
            agent,
            trigger,
            provider,
            order,
            toolsP.then(built => built.heldBackMcp),
        )
        const systemText = systemPromptText(system)

        const pastAuthorIds = await listSessionAuthorIds(agent.id, sessionId).catch(() => [])
        const shared = isSharedConversation(author ? [...pastAuthorIds, author.id] : pastAuthorIds)

        // The tools come first: their schemas ride along on every step, so the compaction threshold
        // has to count them with the history. The MCP tools held back are not sent, so not counted.
        const built = await toolsP
        closeTools = built.close
        const { tools, heldBackMcp } = built
        // The same list on every step and every message: a list that moved would move the start of
        // the prompt, and the provider would read the whole conversation again outside its cache.
        const sentNames = heldBackMcp ? sentToolNames(tools, heldBackMcp) : undefined
        const sentTools = sentNames ? Object.fromEntries(sentNames.map(name => [name, tools[name]])) : tools
        const toolChars = toolPayloadChars(sentTools)
        const stored = await prepareRunHistory(ctx, systemText, runOverride, shared, toolChars)
        const history = repairToolPairs(CLI_PROVIDERS.has(provider) ? stored : withToolResultsInToolMessages(stored))

        const [memories, mcpServers] = await Promise.all([memoriesP, mcpServersP, cliAuthP])
        const recall = recallSection(memories, history)

        // Read before the turn is stored: a resumed thread only gets this turn, so the session must
        // hold nothing the thread has not seen.
        const resumeThreadId = provider === 'codex' ? codexThreadToResume(agent.id, sessionId, connection?.id ?? RERUN_CONNECTION_ID, await lastMessageId(agent.id, sessionId)) : undefined

        // The turn is stored as it is sent, its context part included: the history the next turn
        // replays is then byte for byte the prompt the provider already cached. Only the signature
        // stays out of the row, `signHistoryMessage` puts it back on a shared conversation.
        // A shared conversation already signs each turn with its sender.
        const suffix = [recall, shared ? '' : userBlock(author?.name), relayedBlock(author), calledByBlock(trigger), userLanguageBlock(trigger.source === 'chat' ? trigger.userLanguage : undefined), nowBlock()].filter(Boolean).join('\n\n')
        const context = suffix ? [contextTextPart(suffix)] : []
        if (!handover) {
            appendP = appendMessage(agent.id, sessionId, { role: 'user', content: [{ type: 'text', text: userText }, ...context] }, author)
            appendP.catch(err => logger.error({ err: String(err), agent: agent.id }, 'append user message failed'))
        }
        ctx.userTurnStored = appendP.catch(() => {})

        const turnText = shared ? signText(userText, author) : userText
        const turnMessages: ModelMessage[] = handover ? continuationTurn(history) : [...history, { role: 'user', content: [{ type: 'text', text: turnText }, ...context] }]

        const cached = applyCaching(provider, { system, messages: turnMessages, sessionId, model })
        const compactStep = createInRunCompactor(ctx, { system: systemText, toolChars, override: runOverride, initialMessages: cached.messages })
        logger.debug({ agent: agent.id, provider, prepMs: Date.now() - t0 }, 'run prep done')

        spawnToken = claudeTokenOf(connection)
        let cliCompactionId = newId()
        const onClaudeCompaction = (compaction: ClaudeCompaction): void => {
            if (compaction.status === 'running') cliCompactionId = newId()
            writer?.write({ type: 'data-compaction', id: cliCompactionId, data: compaction })
            if (compaction.status === 'done') logger.info({ agent: agent.id, session: sessionId, run: run.id, tokensRecovered: compaction.tokensRecovered }, 'context compacted by the CLI')
        }
        const resolvedModel = resolveModel(agent, runOverride, tools, mcpServers, { system: systemText, screenshots: id => ctx.screenshots?.get(id), sessionId, readOnly, effort, onClaudeCompaction })
        closeModel = resolvedModel.close
        contextUsage = resolvedModel.contextUsage
        // Cut out of the text whoever wrote it; only a coworker that offers replies gets the buttons.
        if (offersQuickReplies(agent.config)) quickReplies = resolvedModel.quickReplies
        const languageModel = heldBackMcp ? wrapLanguageModel({ model: resolvedModel.model, middleware: mcpWireMiddleware(heldBackMcp) }) : resolvedModel.model

        let lastStepAt = Date.now()
        let runCostMicros: number | null = null
        const result = streamText({
            model: languageModel,
            system: cached.system,
            messages: cached.messages,
            providerOptions: mergeProviderOptions(mergeProviderOptions(mergeProviderOptions(cached.providerOptions, reasoningProviderOptions(provider, model)), effortProviderOptions(provider, effort)), resumeThreadId ? { 'codex-app-server': { threadId: resumeThreadId } } : undefined),
            tools,
            activeTools: sentNames,
            abortSignal: attemptSignal,
            experimental_repairToolCall: repairToolCall,
            stopWhen: ({ steps }) => hitlTurnIsOver(steps, CLI_PROVIDERS.has(provider)),
            // The step that writes the message a bare card is missing gets no tool: `toolChoice`
            // rather than an empty `activeTools`, since Anthropic refuses a transcript holding
            // tool_use blocks when the request defines no tool.
            // A long run is compacted between two steps, before the screenshots are put back in: a
            // summarised step has no screenshot left to show.
            prepareStep: async ({ messages, steps, stepNumber }) => {
                const base = (await compactStep?.({ messages, steps, stepNumber })) ?? messages
                const step = stepWithScreenshots(base, ctx.screenshots, provider, model, connection)
                const shown = step.messages ?? base
                const sent = behaviourOf(provider, model) === 'anthropic' ? withTailBreakpoint(shown) : shown
                return {
                    ...(sent !== messages ? { messages: sent } : {}),
                    ...(!CLI_PROVIDERS.has(provider) && hitlStepLacksMessage(steps) ? { toolChoice: 'none' as const } : {}),
                }
            },
            onChunk: ({ chunk }) => streamed.add(chunk),
            onStepFinish: async step => {
                streamed.stepFinished(step.response.messages)
                steps += 1
                const now = Date.now()
                const durationMs = now - lastStepAt
                lastStepAt = now
                const stepCostMicros = costMicrosFrom(step.providerMetadata)
                if (stepCostMicros !== null) runCostMicros = (runCostMicros ?? 0) + stepCostMicros
                await bumpRunStep(agent.id, run.id, steps).catch(() => {})
                await recordStepTelemetry(agent.id, sessionId, run.id, provider, model, steps, durationMs, step, stepCostMicros).catch(err => logger.warn({ err: String(err), agent: agent.id }, 'record step telemetry failed'))
            },
            onError: async ({ error }) => {
                if (controller.signal.aborted) {
                    await settle({ kind: 'cancelled' })
                    return
                }
                await settle({ kind: 'error', error, errorCode: classifyProviderError(provider, error), messages: streamed.messages() })
            },
            // The only callback the SDK runs when the abort lands before the first step: without it
            // a run stopped early would never write its terminal row.
            onAbort: async () => {
                await settle({ kind: 'cancelled' })
            },
            // `totalUsage`, not `usage`: the latter is the last step alone, and a run that called
            // tools paid every step before it.
            onFinish: async ({ response, totalUsage, text, providerMetadata, finishReason, rawFinishReason }) => {
                if (controller.signal.aborted) {
                    await settle({ kind: 'cancelled' })
                    return
                }
                logger.info({ agent: agent.id, provider, cachedInputTokens: totalUsage.cachedInputTokens, costMicros: runCostMicros, anthropic: providerMetadata?.anthropic }, 'run usage')
                const threadId = providerMetadata?.['codex-app-server']?.threadId
                if (typeof threadId === 'string') codexThreadId = threadId
                // A CLI provider reports a spent subscription or a blown context as a plain finish,
                // not as an error. Taken at face value it stores an empty turn as a success and the
                // reason the agent said nothing is lost.
                if (isFailedFinish(finishReason, rawFinishReason)) {
                    const errorCode = classifyFinishReason(finishReason, rawFinishReason)
                    await settle({
                        kind: 'error',
                        error: errorCode === RUN_ERROR_CODES.streamIncomplete ? new ProviderStreamCutError() : new Error(rawFinishReason ?? finishReason),
                        errorCode,
                        messages: response.messages,
                    })
                    return
                }
                const stepsCostMicros = runCostMicros ?? costMicrosFrom(providerMetadata)
                const costMicros = ctx.compactionCostMicros === undefined ? stepsCostMicros : (stepsCostMicros ?? 0) + ctx.compactionCostMicros
                await settle({ kind: 'done', text, usage: totalUsage, costMicros, messages: response.messages })
            },
        })

        // Drains the stream so the run advances with no HTTP consumer attached, and closes the run
        // when the provider ends the turn without ever reaching a callback. `teeStream` hands out a
        // fresh branch on every access, so this takes nothing away from `toUIMessageStream`.
        void (async () => {
            let drainError: unknown
            await result.consumeStream({
                onError: error => {
                    drainError = error
                },
            })
            await settle(
                controller.signal.aborted
                    ? { kind: 'cancelled' }
                    : {
                          kind: 'error',
                          error: drainError ?? new ProviderStreamCutError(),
                          errorCode: drainError ? classifyProviderError(provider, drainError) : RUN_ERROR_CODES.streamIncomplete,
                          messages: streamed.messages(),
                      },
            )
        })().catch(err => logger.warn({ err: String(err), agent: agent.id, run: run.id }, 'run drain failed'))

        const settledRun = settledPromise.then(outcome => (outcome.kind === 'handover' ? outcome.next.settled : outcome))
        return { result, runId: run.id, settled: settledRun, attempt: settledPromise, provider, model, providerSwitch, contextUsage, quickReplies }
    } catch (err) {
        // Everything past `streamText` is handled by its own callbacks: the `return` above makes
        // this catch unreachable once the stream has started, so a run is closed exactly once.
        if (controller.signal.aborted) {
            await settle({ kind: 'cancelled' })
            throw err
        }
        await settle({ kind: 'error', error: err, errorCode: classifyProviderError(provider, err) })
        throw err
    }
}
