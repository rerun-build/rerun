import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { getAgent } from '../../agents/registry.js'
import { createSession } from '../../db/repos/sessions.js'
import { startHeadlessRun } from '../../runtime/headless-run.js'
import type { AgentRun } from '../../runtime/loop.js'
import { sendNotification } from '../../runtime/notify.js'
import type { RunContext } from '../../runtime/context.js'
import type { AgentRow } from '../../db/schema.js'
import { beginSubRun, endSubRun, followSubRun, renderSubRunOutcome, snapshotSubRun, startHeartbeat, type SubRunProgress } from './sub-run-watch.js'

type CallProgress = SubRunProgress & { agentName: string; sessionId?: string }

// Every coworker on the machine but the caller and the delegates, narrowed to the ones the person
// behind the run reaches when the hub says who that is.
export function callTargetsOf(index: AgentRow[], callerId: string, callableAgentIds?: string[]): AgentRow[] {
    const callable = callableAgentIds ? new Set(callableAgentIds) : null
    return index.filter(a => a.id !== callerId && !a.name.endsWith(' delegate') && (!callable || callable.has(a.id)))
}

export function resolveTargetAgent(ref: string, targets: AgentRow[]): { agent: AgentRow } | { error: string } {
    const allowed = targets.map(t => `${t.name} (id: ${t.id})`).join(', ')
    const byId = targets.find(t => t.id === ref)
    if (byId) return { agent: byId }
    const byName = targets.filter(t => t.name.toLowerCase() === ref.toLowerCase())
    if (byName.length === 1) return { agent: byName[0] }
    if (byName.length > 1) return { error: `Ambiguous coworker name "${ref}". Use an id instead: ${byName.map(t => t.id).join(', ')}` }
    if (targets.length === 0) return { error: 'There are no other coworkers on this engine to call.' }
    return { error: `Coworker "${ref}" was not found. Available coworkers: ${allowed}` }
}

export function callAgentTools(ctx: RunContext): ToolSet {
    const targets = ctx.callTargets ?? []
    const roster = targets.map(t => `${t.name} (id: ${t.id})`).join(', ')
    return {
        call_agent: tool({
            description:
                'Send a one-shot message to another persistent coworker on this engine. Use it whenever your instructions name another coworker to contact (e.g. @someAgent), including from a scheduled task. The called coworker runs in its own fresh session with its own personality, tools and memory. By default the message is dispatched and you move on without waiting; set wait to true when you need the coworker\'s answer to continue. Use delegate_tasks for subtasks of your own work instead.' +
                (roster ? ` Coworkers you can call: ${roster}.` : ''),
            inputSchema: z.object({
                agent: z.string().describe('Name or id of the target coworker, as mentioned by the user'),
                message: z.string().describe('The message to send'),
                context: z.string().optional().describe('Optional background the target coworker needs'),
                wait: z.boolean().default(false).describe('Wait for the answer and return it. Default false: dispatch and move on'),
            }),
            execute: async ({ agent, message, context, wait }, { toolCallId, abortSignal }) => {
                const resolved = resolveTargetAgent(agent, targets)

                // The CLI bridges hand over an id that is not the model's, so the UI pairs progress
                // blocks to tool rows by order: every call emits one, before its first await.
                const progress: CallProgress = { agentName: 'agent' in resolved ? resolved.agent.name : agent, status: 'queued', steps: 0, toolCalls: 0, failures: 0, calls: [] }
                beginSubRun(progress)
                const emit = () => ctx.writer?.write({ type: 'data-call-agent', id: toolCallId, data: snapshotSubRun(progress) })
                const refuse = (reason: string) => {
                    endSubRun(progress, reason)
                    emit()
                    return reason
                }
                emit()
                if ('error' in resolved) return refuse(resolved.error)

                const target = await getAgent(resolved.agent.id)
                if (!target.config.enabled) return refuse(`Coworker "${target.config.name}" is switched off and cannot be called.`)
                const config = structuredClone(target.config)
                config.selfImprovement.enabled = false
                const callee = { ...target, config }

                const session = await createSession(
                    callee.id,
                    `from ${ctx.agent.config.name}: ${message.slice(0, 80)}`,
                    { originAgentId: ctx.agent.id, originSessionId: ctx.sessionId },
                    'agent',
                )

                // Mirrored on the hub before the run starts: a HITL call stops the run without any
                // completion event, so its `awaiting_*` status has nowhere to land if the session
                // row only appears later, when someone opens the conversation.
                await sendNotification({
                    event: 'agent.session.created',
                    kind: 'info',
                    agentId: callee.id,
                    sessionId: session.id,
                    runId: null,
                    message: `Called by ${ctx.agent.config.name}`,
                    title: session.title,
                    source: 'agent',
                    originAgentId: ctx.agent.id,
                })

                const prompt = context ? `${context}\n\n---\n\n${message}` : message

                progress.agentName = target.config.name
                progress.sessionId = session.id
                emit()

                let run: AgentRun
                try {
                    // `fullStream` tees, so following the run for the caller's progress block and
                    // publishing it to the run hub can happen side by side.
                    run = await startHeadlessRun(callee, session.id, prompt, undefined, { source: 'chat', callableAgentIds: ctx.callableAgentIds, calledBy: ctx.agent.id })
                } catch (err) {
                    // A run that never started emits no completion event of its own, so the session
                    // just mirrored on the hub would stay `working` forever.
                    const reason = err instanceof Error ? err.message : String(err)
                    endSubRun(progress, reason)
                    emit()
                    await sendNotification({
                        event: 'agent.message.completed',
                        kind: 'error',
                        agentId: callee.id,
                        sessionId: session.id,
                        runId: null,
                        message: `Message failed: ${reason}`,
                        source: 'agent',
                        metadata: { source: 'agent', status: 'error', error: reason },
                    })
                    return `(error calling ${target.config.name}: ${reason})`
                }

                if (!wait) {
                    // The run drains itself, so a dispatched call needs nothing here to keep going.
                    progress.status = 'dispatched'
                    emit()
                    return `Message dispatched to ${target.config.name}. It is handling it in its own session; you will not receive the answer here.`
                }

                const stopHeartbeat = startHeartbeat(emit)
                try {
                    const outcome = await followSubRun(run, progress, { onChange: emit, parentSignal: ctx.abortSignal ?? abortSignal })
                    endSubRun(progress, outcome.stopReason)
                    emit()
                    return outcome.stopReason === undefined ? outcome.text || '(the coworker returned no text)' : `(error calling ${target.config.name}: ${renderSubRunOutcome(outcome, progress)})`
                } catch (err) {
                    const reason = err instanceof Error ? err.message : String(err)
                    endSubRun(progress, reason)
                    emit()
                    return `(error calling ${target.config.name}: ${reason})`
                } finally {
                    stopHeartbeat()
                }
            },
        }),
    }
}
