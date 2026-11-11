import { rm } from 'node:fs/promises'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
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

type SubProgress = SubRunProgress & { id: string; title: string }

export function delegateTools(ctx: RunContext): ToolSet {
    return {
        delegate_tasks: tool({
            description:
                'Delegate one or more self-contained subtasks to fresh ephemeral sub-coworkers. Pass several independent tasks to run them in parallel and finish faster; pass a single task when the work must stay sequential. Each sub-coworker inherits your tools, model and keys, runs its task to completion in its own workspace, and returns its final answer. Use this to decompose work without polluting your own context. Sub-agents cannot delegate further, and they cannot show anything to the user: the files they produce for you are in the shared space, at the paths their result lists, and it is up to you to show them with card_file and scope \'shared\' before you ask the user anything about them.',
            inputSchema: z.object({
                tasks: z
                    .array(
                        z.object({
                            title: z.string().optional().describe('Short label shown in the UI'),
                            task: z.string().describe('A clear, self-contained instruction for the sub-coworker'),
                            context: z.string().optional().describe('Optional background the sub-coworker needs to do the task'),
                        }),
                    )
                    .min(1)
                    .describe('Run one task, or several in parallel when they are independent'),
            }),
            execute: async ({ tasks }, { toolCallId, abortSignal }) => {
                const parentSignal = ctx.abortSignal ?? abortSignal
                const progress: SubProgress[] = tasks.map(t => ({ id: newId(), title: t.title ?? t.task.slice(0, 60), status: 'queued', steps: 0, toolCalls: 0, failures: 0, calls: [] }))
                const emit = () => ctx.writer?.write({ type: 'data-delegate', id: toolCallId, data: { tasks: progress.map(snapshotSubRun) } })
                emit()

                const runOne = async (index: number): Promise<string> => {
                    const { task, context } = tasks[index]
                    const current = progress[index]
                    beginSubRun(current)
                    emit()
                    const config = structuredClone(ctx.agent.config)
                    config.name = `${ctx.agent.config.name} delegate`
                    config.ephemeral = true
                    config.tools.delegate = false
                    // A card is addressed to the user, and nobody reads a delegate's session.
                    config.tools.cards = false
                    // The delegate's workspace dies with its task: the shared space is the only
                    // place a file it produced survives, so it gets the tools to write there.
                    config.tools.shared = true
                    // Nobody can answer a delegate either: a question would end its run on a wait
                    // nobody sees, and the caller would get an empty result.
                    config.tools.askUser = false
                    config.tools.requestApproval = false
                    config.tools.suggestService = false
                    config.tools.requestSecret = false
                    // A delegate does one task and reports to its caller: nothing it could install,
                    // schedule or publish on the account is wanted, nobody is there to be notified,
                    // and a spend it cannot ask for only runs where the user waived the asking.
                    config.tools.hub = false
                    config.tools.trigger = false
                    config.tools.schedule = false
                    config.tools.callAgent = false
                    config.tools.notify = false
                    if (!config.paidDataAlwaysAllow) config.tools.paidData = false
                    config.selfImprovement.enabled = false
                    // Pinned from the run rather than copied from the config: a parent following the
                    // box default would hand the child a null model, and the child would resolve the
                    // box default again instead of the model this turn is actually running on.
                    config.connectionId = ctx.agent.resolved.connection?.id ?? null
                    config.provider = ctx.provider
                    config.model = ctx.model
                    const child = await createAgent({ config, soul: ctx.agent.soul, keys: ctx.agent.env })
                    const taskSignal = registerSubRunStop(current.id)
                    try {
                        const session = await createSession(child.id, `delegated: ${task.slice(0, 80)}`, undefined, 'delegate')
                        const prompt = context ? `${context}\n\n---\n\n${task}` : task
                        const run = await runAgent(child, session.id, prompt)
                        const outcome = await followSubRun(run, current, { onChange: emit, parentSignal, taskSignal })
                        endSubRun(current, outcome.stopReason, outcome.stopReason === SUB_RUN_STOPPED_BY_USER ? 'stopped' : 'error')
                        emit()
                        const text = renderSubRunOutcome(outcome, current)
                        if (outcome.stopReason === undefined) ctx.partialResults?.push({ label: `Task ${index + 1} — ${current.title}`, text })
                        return text
                    } finally {
                        unregisterSubRunStop(current.id)
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
