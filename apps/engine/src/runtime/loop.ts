import { streamText, ToolChoiceViolationError, type LanguageModelUsage, type ModelMessage, type StreamTextResult, type ToolSet, type UIMessageStreamWriter } from 'ai'
import { RERUN_CONNECTION_ID, contextTextPart, type ContextOccupancy, type GoalVerdict, type MessageAuthor } from '@rerun/contracts'
import { applyCaching, withTailBreakpoint } from '../agents/caching.js'
import { mergeProviderOptions, reasoningProviderOptions } from '../agents/reasoning.js'
import { prepareRunHistory } from './compaction/compact.js'
import { repairToolPairs } from './compaction/repair.js'
import { approvalSummary, canonicalHitlName, findPendingHitl, hitlStepLacksMessage, hitlTurnIsOver, isHitlToolName, secretSummary, takeoverSummary, type PendingHitl } from '../tools/builtin/hitl.js'
import { goalStopHook } from '../agents/claude-goal-hook.js'
import { CLI_PROVIDERS, resolveModel, type GoalOption, type ModelOverride } from '../agents/providers.js'
import { offersQuickReplies, quickRepliesCall, type QuickRepliesCapture } from '../agents/quick-replies-stream.js'
import { codexThreadToResume, forgetCodexThread, rememberCodexThread } from '../agents/codex-threads.js'
import { repairBoxDefault, resolveRunModel } from '../agents/availability.js'
import { claudeTokenOf, claudeTokenOutlived } from '../connections/claude-token.js'
import { ensureCliAuth } from '../connections/cli-auth.js'
import { syncCodexAuth } from '../connections/codex-auth.js'
import { forgetCredentialRejected, recordCredentialRejected } from '../connections/credential-rejections.js'
import { recordRefusedModel } from '../connections/cli-models.js'
import { refreshCodexPlanLimits } from '../connections/codex-plan-limits.js'
import { armPlanLimitLatch, clearPlanLimitLatch } from '../connections/plan-limits.js'
import { refreshOpencodePlanLimits } from '../connections/opencode-plan-limits.js'
import { behaviourOf } from '../agents/opencode.js'
import { buildSystemPrompt, nowBlock, recallMemories, recallSection, systemPromptText, userBlock, userLanguageBlock } from '../agents/systemPrompt.js'
import type { LoadedAgent } from '../agents/types.js'
import { turnOrder } from '../agents/turn-order.js'
import { answeringModel } from '../agents/rerun-upstream.js'
import { listAgentIndex } from '../db/repos/agents.js'
import { appendMessage, lastMessageId, listSessionAuthorIds, setMessageToolCalls } from '../db/repos/messages.js'
import type { MessageRow } from '../db/schema.js'
import { isSharedConversation, signText } from './message-authors.js'
import { bumpRunStep, cancelRun, failRun, finishRun, recordGoalVerdict, setRunContext, setRunGoal, setRunLineage, startRun, updateRunLive } from '../db/repos/runs.js'
import { insertRunStep, insertToolCall } from '../db/repos/telemetry.js'
import { touchSession } from '../db/repos/sessions.js'
import { logger } from '../lib/logger.js'
import { newId, nowIso } from '../lib/ids.js'
import { buildTools } from '../tools/registry.js'
import { callTargetsOf } from '../tools/builtin/call-agent.js'
import { toolPayloadChars } from '../tools/payload.js'
import { wrapToolsWithResultHandle } from '../tools/result-handle.js'
import { prepareMcpServer } from '../tools/mcp.js'
import { withPooledRelays } from '../tools/mcp-relay.js'
import { HostBreaker } from '../tools/host-breaker.js'
import { checkGoal } from './goal-check.js'
import type { DelegatedUsage, PartialResult, RunContext, RunLineage, RunTrigger, SkillProposalNotice } from './context.js'
import { parseJobRef } from './job-ref.js'
import { partialResultsNote } from './partial-results.js'
import { plusDelegated } from './delegated-usage.js'
import { registerRunAbort, setRunCancel, syncAgentStatus, unregisterRunAbort } from './run-control.js'
import { runCurator } from './curator.js'
import { repairToolCall } from './tool-repair.js'
import { sessionLabels } from '../agents/session-labels.js'
import { stepWithScreenshots } from './screenshots.js'
import { authorMetadata, sendNotification, type NotificationKind } from './notify.js'
import { emitRunTerminal } from './run-events.js'
import { ClaudeSignInRenewedError, classifyFinishReason, classifyProviderError, errorMessageOf, isFailedFinish, ProviderRefusedError, ProviderStreamCutError, RUN_ERROR_CODES, refusalReason, unreachableEndpointError, type RunErrorCode } from './provider-errors.js'
import { createLiveCounter, type LiveCounter } from './live-counter.js'

export type RunOutcome = { kind: 'done' | 'error' | 'cancelled'; error?: string; errorCode?: RunErrorCode | null }

export type AgentRun = {
    result: StreamTextResult<ToolSet, never>
    runId: string
    settled: Promise<RunOutcome>
    contextUsage?: () => ContextOccupancy | undefined
    quickReplies?: () => QuickRepliesCapture | undefined
}

export type { RunTrigger }

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

function hitlKind(toolName: string): NotificationKind {
    if (toolName === 'ask_user') return 'question'
    if (toolName === 'suggest_service' || toolName === 'request_secret' || toolName === 'request_mcp_sign_in') return 'connector'
    return 'approval'
}

function hitlMessage(toolName: string, input: Record<string, unknown> | undefined): string {
    if (toolName === 'ask_user') return questionSummary(input)
    if (toolName === 'suggest_service') return serviceSummary(input)
    if (toolName === 'request_secret') return secretSummary(input)
    if (toolName === 'request_mcp_sign_in') return `Sign in to ${String(input?.name ?? 'an MCP server')}`
    if (toolName === 'request_takeover') return takeoverSummary(input)
    return approvalSummary(input)
}

async function emitHitlEvent(agent: LoadedAgent, sessionId: string, runId: string, pending: PendingHitl, author: MessageAuthor | undefined): Promise<void> {
    const kind = hitlKind(pending.toolName)
    const input = pending.input as Record<string, unknown> | undefined
    const message = hitlMessage(pending.toolName, input)
    await sendNotification({ event: 'agent.notification', kind, agentId: agent.id, sessionId, runId, message, metadata: { toolCallId: pending.toolCallId, toolName: pending.toolName, input: pending.input, ...authorMetadata(author) } }).catch(() => {})
}

async function emitSkillProposalEvent(agent: LoadedAgent, sessionId: string, runId: string, notice: SkillProposalNotice, author: MessageAuthor | undefined): Promise<void> {
    const message = notice.mode === 'edit' ? `Wants to update a skill: ${notice.title}` : `Wants to save a new skill: ${notice.title}`
    await sendNotification({ event: 'agent.notification', kind: 'approval', agentId: agent.id, sessionId, runId, message, metadata: { toolName: 'skill_propose', proposalId: notice.proposalId, ...authorMetadata(author) } }).catch(() => {})
}

function costMicrosFrom(providerMetadata: unknown): number | null {
    const metadata = providerMetadata as { openrouter?: { usage?: { cost?: unknown } }; opencode?: { cost?: unknown } } | undefined
    const cost = metadata?.opencode?.cost ?? metadata?.openrouter?.usage?.cost
    return typeof cost === 'number' && Number.isFinite(cost) ? Math.round(cost * 1_000_000) : null
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

async function recordStepTelemetry(agentId: string, sessionId: string, runId: string, provider: string, model: string, stepNumber: number, durationMs: number, step: StepLike, costMicros: number | null, effort: string | null): Promise<void> {
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
        effort,
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
    return runTurn(agent, sessionId, userText, override, writer, runId, trigger)
}

type Settlement =
    | { kind: 'done'; text: string; usage: LanguageModelUsage | undefined; costMicros: number | null; messages: ModelMessage[] }
    | { kind: 'error'; error: unknown; errorCode?: RunErrorCode | null; messages?: ModelMessage[] }
    | { kind: 'cancelled' }

async function runTurn(baseAgent: LoadedAgent, sessionId: string, userText: string, override: ModelOverride | undefined, writer: UIMessageStreamWriter | undefined, runId: string | undefined, trigger: RunTrigger): Promise<AgentRun> {
    const run = runId ? { id: runId } : await startRun(baseAgent.id, sessionId)
    const controller = registerRunAbort(run.id, baseAgent.id, writer)
    const author = trigger.source === 'chat' ? trigger.author : undefined

    let agent = baseAgent
    let { connection, provider, model } = baseAgent.resolved
    let closeTools = async (): Promise<void> => {}
    let closeModel = async (): Promise<void> => {}
    let appendP: Promise<unknown> = Promise.resolve()
    let contextUsage: (() => ContextOccupancy | undefined) | undefined
    let quickReplies: (() => QuickRepliesCapture | undefined) | undefined
    let cliAuthP: Promise<() => void> | undefined
    let spawnToken: string | undefined
    let codexThreadId: string | undefined
    let steps = 0
    let goalOption: GoalOption | undefined
    let goalChecked: 'met' | 'not_met' | undefined
    const goalOf = trigger.source === 'chat' ? trigger.goal : undefined
    let live: LiveCounter | undefined
    const stepsToWrite = (): number => Math.max(steps, live?.snapshot().toolCalls ?? 0)
    const partialResults: PartialResult[] = []
    const delegated: DelegatedUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 0 }
    const skillProposals: SkillProposalNotice[] = []

    const close = async (): Promise<void> => {
        await closeModel().catch(err => logger.warn({ err: String(err), agent: agent.id }, 'close model failed'))
        await closeTools().catch(err => logger.warn({ err: String(err), agent: agent.id }, 'close tools failed'))
        if (provider === 'codex') {
            await syncCodexAuth(connection).catch(() => {})
            void refreshCodexPlanLimits(connection)
        }
        if (provider === 'opencode') void refreshOpencodePlanLimits(connection)
    }

    const closeSafely = async (): Promise<void> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const guard = new Promise<void>(resolve => {
            timer = setTimeout(() => {
                logger.warn({ agent: agent.id, run: run.id, provider }, 'run teardown timed out')
                resolve()
            }, CLOSE_TIMEOUT_MS)
        })
        await Promise.race([close().catch(() => {}), guard])
        if (timer) clearTimeout(timer)
    }

    let toolCallWithheld = false
    let settled = false
    let resolveSettled!: (outcome: RunOutcome) => void
    const settledPromise = new Promise<RunOutcome>(resolve => {
        resolveSettled = resolve
    })

    const settle = async (settlement: Settlement): Promise<RunOutcome> => {
        if (settled) return settledPromise
        settled = true
        live?.dispose()

        await appendP.catch(() => {})

        let outcome: RunOutcome
        let pending: PendingHitl | null = null
        let text: string | undefined
        let usage: LanguageModelUsage | undefined
        let costMicros: number | null = null

        if (settlement.kind === 'done') {
            const messages = canonicalizeHitlNames(settlement.messages)
            let answerRow: MessageRow | undefined
            for (const message of messages) {
                const row = await appendMessage(agent.id, sessionId, message).catch(() => undefined)
                if (row?.role === 'assistant') answerRow = row
            }
            pending = findPendingHitl(messages)
            const replies = quickReplies?.()
            if (replies && answerRow && !pending) await setMessageToolCalls(agent.id, answerRow.id, [quickRepliesCall(replies)]).catch(() => {})
            if (provider === 'codex') await keepCodexThread().catch(() => forgetCodexThread(agent.id, sessionId))
            if (goalOf) {
                if (goalOption?.hook) goalChecked = goalOption.hook.state() === 'met' ? 'met' : 'not_met'
                else {
                    const verdict = checkGoal(goalOf, settlement.text, 1)
                    await recordGoalVerdict(agent.id, run.id, verdict).catch(() => {})
                    goalChecked = verdict.met ? 'met' : 'not_met'
                }
            }
            await finishRun(agent.id, run.id, plusDelegated(settlement.usage, delegated), stepsToWrite(), settlement.costMicros, contextUsage?.(), goalChecked).catch(() => {})
            await touchSession(agent.id, sessionId).catch(() => {})
            text = settlement.text
            usage = settlement.usage
            costMicros = settlement.costMicros
            if (connection) {
                forgetCredentialRejected(connection.id)
                clearPlanLimitLatch(connection.id)
            }
            outcome = { kind: 'done' }
        } else if (settlement.kind === 'cancelled') {
            forgetCodexThread(agent.id, sessionId)
            if (partialResults.length) await appendMessage(agent.id, sessionId, { role: 'assistant', content: partialResultsNote(partialResults) }).catch(() => {})
            await cancelRun(agent.id, run.id).catch(() => {})
            outcome = { kind: 'cancelled' }
        } else {
            const renewed = settlement.errorCode === RUN_ERROR_CODES.unauthorized && provider === 'claude' && claudeTokenOutlived(connection, spawnToken)
            if (renewed) settlement = { ...settlement, error: new ClaudeSignInRenewedError(), errorCode: RUN_ERROR_CODES.authRenewed }
            if (settlement.errorCode === RUN_ERROR_CODES.refused) settlement = { ...settlement, error: new ProviderRefusedError(refusalReason(settlement.error)) }
            const unreachable = provider === 'custom' ? unreachableEndpointError(connection?.config.baseUrl, settlement.error) : null
            if (unreachable) settlement = { ...settlement, error: unreachable }
            const errorCode = settlement.errorCode ?? null
            const errorMessage = errorMessageOf(settlement.error)
            forgetCodexThread(agent.id, sessionId)
            logger.error({ err: errorMessage, errorCode, agent: agent.id, run: run.id }, 'run error')
            if (errorCode === RUN_ERROR_CODES.usageLimit && connection && connection.id !== RERUN_CONNECTION_ID) armPlanLimitLatch(connection.id)
            if (errorCode === RUN_ERROR_CODES.unauthorized && connection && connection.id !== RERUN_CONNECTION_ID) recordCredentialRejected(connection.id)
            if (errorCode === RUN_ERROR_CODES.modelNotInPlan && provider === 'codex' && connection) {
                const refusedOn = connection
                recordRefusedModel(refusedOn.id, model)
                await repairBoxDefault(refusedOn).catch(err => logger.warn({ err: String(err), connection: refusedOn.id }, 'box default repair failed'))
            }
            if (settlement.messages) for (const message of canonicalizeHitlNames(settlement.messages)) await appendMessage(agent.id, sessionId, message).catch(() => {})
            await failRun(agent.id, run.id, errorMessage).catch(() => {})
            outcome = { kind: 'error', error: errorMessage, errorCode }
        }

        await closeSafely()
        void cliAuthP?.then(release => release(), () => {})
        unregisterRunAbort(run.id)
        await syncAgentStatus(agent.id).catch(() => {})
        resolveSettled(outcome)

        if (pending) {
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

        if (outcome.kind === 'done' && !pending && agent.config.selfImprovement.enabled && userText) {
            void runCurator(agent, sessionId, userText, text ?? '', override).catch(e => logger.warn({ err: String(e) }, 'curator failed'))
        }

        return outcome
    }

    const keepCodexThread = async (): Promise<void> => {
        const throughMessageId = codexThreadId ? await lastMessageId(agent.id, sessionId) : undefined
        if (!codexThreadId || !throughMessageId) return forgetCodexThread(agent.id, sessionId)
        rememberCodexThread(agent.id, sessionId, { threadId: codexThreadId, connectionId: connection?.id ?? RERUN_CONNECTION_ID, throughMessageId })
    }

    setRunCancel(run.id, () => {
        void settle({ kind: 'cancelled' }).catch(err => logger.warn({ err: String(err), agent: agent.id, run: run.id }, 'run cancel failed'))
    })

    try {
        const memoriesP = recallMemories(baseAgent, userText)
        const resolved = await resolveRunModel(baseAgent, override)
        agent = resolved === baseAgent.resolved ? baseAgent : { ...baseAgent, resolved }
        ;({ connection, provider, model } = resolved)
        const t0 = Date.now()
        const order = turnOrder(provider, await answeringModel(provider, model))
        const callableAgentIds = trigger.source === 'chat' ? trigger.callableAgentIds : undefined
        const ctx: RunContext = { agent, sessionId, logger, provider, model, turnOrder: order, author, writer, abortSignal: controller.signal, callTargets: [], callableAgentIds, hostBreaker: new HostBreaker(), partialResults, delegated, skillProposals }

        ctx.runId = run.id
        const triggerSlug = 'slug' in trigger ? trigger.slug : null
        void setRunContext(agent.id, run.id, { provider, model, triggerSource: trigger.source, triggerSlug }).catch(() => {})
        const lineage: RunLineage = { ...(trigger.source === 'chat' ? trigger.lineage : undefined) }
        if (author?.id) lineage.initiatorUserId = author.id
        const parsedJob = parseJobRef(userText)
        if (!lineage.jobRef && parsedJob) lineage.jobRef = parsedJob.jobRef
        ctx.lineage = lineage
        void setRunLineage(agent.id, run.id, lineage).catch(() => {})
        const goal = trigger.source === 'chat' ? trigger.goal : undefined
        if (goal) {
            await setRunGoal(agent.id, run.id, JSON.stringify(goal))
            if (provider === 'claude') {
                const record = (v: GoalVerdict): Promise<void> => recordGoalVerdict(agent.id, run.id, v)
                goalOption = { goal, record, hook: goalStopHook(goal, record) }
            }
        }

        const callTargetsP = agent.config.tools.callAgent ? listAgentIndex().then(idx => callTargetsOf(idx, agent.id, callableAgentIds)) : Promise.resolve([])
        const toolsP = callTargetsP.then(callTargets => {
            ctx.callTargets = callTargets
            return buildTools(ctx)
        })
        const preparedP = CLI_PROVIDERS.has(provider) ? Promise.all(agent.config.mcpServers.map(s => prepareMcpServer(agent.id, s, agent.env, agent.hubAgentId))) : Promise.resolve([])
        const mcpServersP = provider === 'claude' ? preparedP.then(servers => withPooledRelays(agent, servers)) : preparedP
        cliAuthP = ensureCliAuth(provider, connection)

        void syncAgentStatus(agent.id).catch(err => logger.warn({ err: String(err), agent: agent.id }, 'syncAgentStatus failed'))

        const system = await buildSystemPrompt(agent, trigger, provider, order)
        const systemText = systemPromptText(system)

        const pastAuthorIds = await listSessionAuthorIds(agent.id, sessionId).catch(() => [])
        const shared = isSharedConversation(author ? [...pastAuthorIds, author.id] : pastAuthorIds)

        const built = await toolsP
        closeTools = built.close
        const tools = wrapToolsWithResultHandle(built.tools, { agentId: agent.id, runId: run.id })
        const history = repairToolPairs(await prepareRunHistory(ctx, systemText, override, shared, toolPayloadChars(tools)))

        const [memories, mcpServers] = await Promise.all([memoriesP, mcpServersP, cliAuthP])
        const recall = recallSection(memories, history)

        const resumeThreadId = provider === 'codex' ? codexThreadToResume(agent.id, sessionId, connection?.id ?? RERUN_CONNECTION_ID, await lastMessageId(agent.id, sessionId)) : undefined

        const suffix = [recall, shared ? '' : userBlock(author?.name), userLanguageBlock(trigger.source === 'chat' ? trigger.userLanguage : undefined), nowBlock()].filter(Boolean).join('\n\n')
        const context = suffix ? [contextTextPart(suffix)] : []
        appendP = appendMessage(agent.id, sessionId, { role: 'user', content: [{ type: 'text', text: userText }, ...context] }, author)
        appendP.catch(err => logger.error({ err: String(err), agent: agent.id }, 'append user message failed'))
        ctx.userTurnStored = appendP.catch(() => {})

        const turnText = shared ? signText(userText, author) : userText
        const turnMessages: ModelMessage[] = [...history, { role: 'user', content: [{ type: 'text', text: turnText }, ...context] }]

        const cached = applyCaching(provider, { system, messages: turnMessages, sessionId, model })
        logger.debug({ agent: agent.id, provider, prepMs: Date.now() - t0 }, 'run prep done')

        spawnToken = claudeTokenOf(connection)
        const resolvedModel = resolveModel(agent, override, tools, mcpServers, { system: systemText, screenshots: id => ctx.screenshots?.get(id), sessionId, goal: goalOption, labels: sessionLabels({ agentId: agent.id, agentName: agent.config.name, sessionId, runId: run.id, jobRef: ctx.lineage?.jobRef, branch: ctx.lineage?.branch }) })
        closeModel = resolvedModel.close
        contextUsage = resolvedModel.contextUsage
        if (offersQuickReplies(agent.config)) quickReplies = resolvedModel.quickReplies
        const languageModel = resolvedModel.model

        if (CLI_PROVIDERS.has(provider)) live = createLiveCounter({ flush: ({ toolCalls }) => updateRunLive(agent.id, run.id, { stepCount: toolCalls }) })
        let lastStepAt = Date.now()
        let runCostMicros: number | null = null
        const result = streamText({
            model: languageModel,
            system: cached.system,
            messages: cached.messages,
            providerOptions: mergeProviderOptions(mergeProviderOptions(cached.providerOptions, reasoningProviderOptions(provider, model, agent.config.thinkingLevel)), resumeThreadId ? { 'codex-app-server': { threadId: resumeThreadId } } : undefined),
            tools,
            abortSignal: controller.signal,
            experimental_repairToolCall: repairToolCall,
            stopWhen: ({ steps }) => hitlTurnIsOver(steps, CLI_PROVIDERS.has(provider)),
            prepareStep: ({ messages, steps }) => {
                const step = stepWithScreenshots(messages, ctx.screenshots, provider, model, connection)
                return {
                    ...step,
                    ...(behaviourOf(provider, model) === 'anthropic' ? { messages: withTailBreakpoint(step.messages ?? messages) } : {}),
                    ...(!CLI_PROVIDERS.has(provider) && hitlStepLacksMessage(steps) ? { toolChoice: 'none' as const } : {}),
                }
            },
            onChunk: ({ chunk }) => {
                if (chunk.type === 'tool-call') live?.addToolCall()
            },
            onStepFinish: async step => {
                steps += 1
                const now = Date.now()
                const durationMs = now - lastStepAt
                lastStepAt = now
                const stepCostMicros = costMicrosFrom(step.providerMetadata)
                if (stepCostMicros !== null) runCostMicros = (runCostMicros ?? 0) + stepCostMicros
                await bumpRunStep(agent.id, run.id, stepsToWrite()).catch(() => {})
                await recordStepTelemetry(agent.id, sessionId, run.id, provider, model, steps, durationMs, step, stepCostMicros, agent.config.thinkingLevel ?? null).catch(err => logger.warn({ err: String(err), agent: agent.id }, 'record step telemetry failed'))
            },
            onError: async ({ error }) => {
                if (controller.signal.aborted) {
                    await settle({ kind: 'cancelled' })
                    return
                }
                if (error instanceof ToolChoiceViolationError) {
                    toolCallWithheld = true
                    return
                }
                await settle({ kind: 'error', error, errorCode: classifyProviderError(provider, error) })
            },
            onAbort: async () => {
                await settle({ kind: 'cancelled' })
            },
            onFinish: async ({ response, totalUsage, text, providerMetadata, finishReason, rawFinishReason }) => {
                if (controller.signal.aborted) {
                    await settle({ kind: 'cancelled' })
                    return
                }
                logger.info({ agent: agent.id, provider, cachedInputTokens: totalUsage.cachedInputTokens, costMicros: runCostMicros, anthropic: providerMetadata?.anthropic }, 'run usage')
                const threadId = providerMetadata?.['codex-app-server']?.threadId
                if (typeof threadId === 'string') codexThreadId = threadId
                if (!toolCallWithheld && isFailedFinish(finishReason, rawFinishReason)) {
                    const errorCode = classifyFinishReason(finishReason, rawFinishReason)
                    await settle({
                        kind: 'error',
                        error: errorCode === RUN_ERROR_CODES.streamIncomplete ? new ProviderStreamCutError() : new Error(rawFinishReason ?? finishReason),
                        errorCode,
                        messages: response.messages,
                    })
                    return
                }
                await settle({ kind: 'done', text, usage: totalUsage, costMicros: runCostMicros ?? costMicrosFrom(providerMetadata), messages: response.messages })
            },
        })

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
                      },
            )
        })().catch(err => logger.warn({ err: String(err), agent: agent.id, run: run.id }, 'run drain failed'))

        return { result, runId: run.id, settled: settledPromise, contextUsage, quickReplies }
    } catch (err) {
        if (controller.signal.aborted) {
            await settle({ kind: 'cancelled' })
            throw err
        }
        await settle({ kind: 'error', error: err, errorCode: classifyProviderError(provider, err) })
        throw err
    }
}
