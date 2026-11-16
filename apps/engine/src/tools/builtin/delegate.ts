import { rm } from 'node:fs/promises'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { TOOL_KEYS } from '@rerun/contracts'
import { servesModel } from '../../connections/resolve.js'
import { createAgent } from '../../agents/factory.js'
import { unloadAgent } from '../../agents/registry.js'
import { deleteAgentIndex } from '../../db/repos/agents.js'
import { createSession } from '../../db/repos/sessions.js'
import { closeSystemDb } from '../../db/systemDb.js'
import { closeAgentDb } from '../../db/agentDb.js'
import { agentDir } from '../../config/paths.js'
import { newId } from '../../lib/ids.js'
import { runAgent } from '../../runtime/loop.js'
import type { RunContext } from '../../runtime/context.js'
import { USAGE_KEYS } from '../../runtime/delegated-usage.js'
import { getRun } from '../../db/repos/runs.js'
import { insertRunStep, listRunSteps } from '../../db/repos/telemetry.js'
import {
    SUB_RUN_STOPPED_BY_USER,
    beginSubRun,
    endSubRun,
    followSubRun,
    registerSubRunStop,
    renderSubRunOutcome,
    snapshotSubRun,
    startHeartbeat,
    unregisterSubRunStop,
    type SubRunProgress,
} from './sub-run-watch.js'

const MAX_CONCURRENCY = 4

export const READER_SOUL = [
    'You are a reader. You answer one question about a codebase or a set of files and you report only what you read.',
    'Your answer names the file, the function and the quoted lines that prove each fact, and nothing else.',
    'You give no opinion and no plan. You do not guess: when you did not find something, say so.',
    'Change nothing: do not write, edit, move or delete any file, and run only commands that read.',
].join('\n')

async function keepChildUsage(ctx: RunContext, childId: string, runId: string): Promise<void> {
    try {
        const row = await getRun(childId, runId)
        const steps = await listRunSteps(childId, runId)
        if (ctx.delegated && row) for (const key of USAGE_KEYS) ctx.delegated[key] += row[key] ?? 0
        for (const step of steps) {
            await insertRunStep(ctx.agent.id, { ...step, id: newId(), runId: ctx.runId ?? runId, agentId: ctx.agent.id, sessionId: ctx.sessionId })
        }
    } catch (err) {
        ctx.logger.warn({ err: String(err), child: childId, run: runId }, 'delegated usage not kept')
    }
}

type SubProgress = SubRunProgress & { id: string; title: string }

export function delegateTools(ctx: RunContext): ToolSet {
    return {
        delegate_tasks: tool({
            description:
                'Delegate self-contained subtasks to fresh ephemeral sub-coworkers. Pass several independent tasks to run them in parallel and finish faster; pass a single task when the work must stay sequential. Each inherits your tools, model and keys, runs to completion in its own workspace, and returns its final answer. Sub-agents cannot delegate further, and they cannot show anything to the user: the files they produce for you are in the shared space, at the paths their result lists, and show them with card_file and scope \'shared\' before you ask the user about them.',
            inputSchema: z.object({
                tasks: z
                    .array(
                        z.object({
                            title: z.string().optional().describe('Short UI label'),
                            task: z.string().describe('A clear, self-contained instruction for the sub-coworker'),
                            context: z.string().optional().describe('Optional background'),
                            model: z.string().optional().describe('A model your connection serves: runs the task as a reader'),
                            thinkingLevel: z.enum(['low', 'medium', 'high']).optional().describe('Effort'),
                        }),
                    )
                    .min(1)
                    .describe('One task, or several in parallel'),
            }),
            execute: async ({ tasks }, { toolCallId, abortSignal }) => {
                const connection = ctx.agent.resolved.connection
                const refused = [...new Set(tasks.flatMap(t => (t.model && !(connection && servesModel(connection, t.model)) ? [t.model] : [])))]
                if (refused.length > 0) {
                    const served = connection ? [...connection.config.models, ...connection.config.extraModels] : []
                    return `Not started: this connection does not serve ${refused.join(', ')}. Served models: ${served.length > 0 ? served.join(', ') : '(none)'}. Pick one of these or leave the model out.`
                }
                const parentSignal = ctx.abortSignal ?? abortSignal
                const progress: SubProgress[] = tasks.map(t => ({ id: newId(), title: t.title ?? t.task.slice(0, 60), status: 'queued', steps: 0, toolCalls: 0, failures: 0, calls: [] }))
                const emit = () => ctx.writer?.write({ type: 'data-delegate', id: toolCallId, data: { tasks: progress.map(snapshotSubRun) } })
                emit()

                const runOne = async (index: number): Promise<string> => {
                    const { task, context, model, thinkingLevel } = tasks[index]
                    const current = progress[index]
                    beginSubRun(current)
                    emit()
                    const config = structuredClone(ctx.agent.config)
                    config.name = `${ctx.agent.config.name} delegate`
                    config.ephemeral = true
                    config.tools.delegate = false
                    config.tools.cards = false
                    config.tools.shared = true
                    config.tools.askUser = false
                    config.tools.requestApproval = false
                    config.tools.suggestService = false
                    config.tools.requestSecret = false
                    config.tools.hub = false
                    config.tools.trigger = false
                    config.tools.schedule = false
                    config.tools.callAgent = false
                    config.tools.notify = false
                    config.selfImprovement.enabled = false
                    config.connectionId = ctx.agent.resolved.connection?.id ?? null
                    config.provider = ctx.provider
                    config.model = ctx.model
                    if (model) {
                        config.model = model
                        config.thinkingLevel = thinkingLevel ?? null
                        for (const key of TOOL_KEYS) config.tools[key] = key === 'filesystem' || key === 'shell'
                        config.mcpServers = []
                    }
                    const child = await createAgent({ config, soul: model ? READER_SOUL : ctx.agent.soul, keys: ctx.agent.env })
                    child.hubAgentId = ctx.agent.id
                    const taskSignal = registerSubRunStop(current.id)
                    let started: Awaited<ReturnType<typeof runAgent>> | undefined
                    try {
                        const session = await createSession(child.id, `delegated: ${task.slice(0, 80)}`, undefined, 'delegate')
                        const prompt = context ? `${context}\n\n---\n\n${task}` : task
                        const run = await runAgent(child, session.id, prompt)
                        started = run
                        const outcome = await followSubRun(run, current, { onChange: emit, parentSignal, taskSignal })
                        endSubRun(current, outcome.stopReason, outcome.stopReason === SUB_RUN_STOPPED_BY_USER ? 'stopped' : 'error')
                        emit()
                        const text = renderSubRunOutcome(outcome, current)
                        if (outcome.stopReason === undefined) ctx.partialResults?.push({ label: `Task ${index + 1} — ${current.title}`, text })
                        return text
                    } finally {
                        unregisterSubRunStop(current.id)
                        if (started) {
                            await started.settled.catch(() => {})
                            await keepChildUsage(ctx, child.id, started.runId)
                        }
                        unloadAgent(child.id)
                        closeSystemDb(child.id)
                        closeAgentDb(child.id)
                        await deleteAgentIndex(child.id).catch(() => {})
                        await rm(agentDir(child.id), { recursive: true, force: true }).catch(() => {})
                    }
                }

                const results: string[] = new Array(tasks.length).fill('(not started: the calling run was stopped)')
                let next = 0
                const worker = async (): Promise<void> => {
                    while (next < tasks.length && !parentSignal?.aborted) {
                        const index = next++
                        try {
                            results[index] = await runOne(index)
                        } catch (err) {
                            const reason = err instanceof Error ? err.message : String(err)
                            endSubRun(progress[index], reason)
                            emit()
                            results[index] = `(error: ${reason})`
                        }
                    }
                }
                const stopHeartbeat = startHeartbeat(emit)
                try {
                    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, tasks.length) }, () => worker()))
                } finally {
                    stopHeartbeat()
                }

                return tasks.map((t, i) => `## Task ${i + 1} — ${t.title ?? t.task.slice(0, 80)}\n${results[i]}`).join('\n\n')
            },
        }),
    }
}
