import type { ModelOverride } from '../agents/providers.js'
import type { LoadedAgent } from '../agents/types.js'
import { startRun } from '../db/repos/runs.js'
import { runAgent, type AgentRun, type RunTrigger } from './loop.js'
import { mergeRunStream } from './run-stream-merge.js'
import { registerRun } from './stream.js'

// A run nobody is streaming over HTTP (schedule, trigger, call_agent). It still publishes its
// UI message stream to the run hub, so the dashboard can attach to it later and replay it from
// the start. The returned promise settles as soon as `runAgent` hands back, so callers keep the
// error they used to get for a failed run preparation instead of losing it inside the stream.
// `runId` is the caller's when it had to claim the session before the run existed.
export async function startHeadlessRun(agent: LoadedAgent, sessionId: string, message: string, override: ModelOverride | undefined, trigger: RunTrigger, runId?: string): Promise<AgentRun> {
    const run = await startRun(agent.id, sessionId, runId)
    const meta = { provider: override?.provider ?? agent.resolved.provider, model: override?.model ?? agent.resolved.model }

    let started!: (value: AgentRun) => void
    let failed!: (reason: unknown) => void
    const startedPromise = new Promise<AgentRun>((resolve, reject) => {
        started = resolve
        failed = reject
    })

    const registered = registerRun(run.id, async writer => {
        let agentRun: AgentRun
        try {
            agentRun = await runAgent(agent, sessionId, message, override, writer, run.id, trigger)
        } catch (err) {
            failed(err)
            throw err
        }
        started(agentRun)
        mergeRunStream(writer, agentRun, meta)
    })

    // No body means nothing drains the run, so it would never start and the caller would wait
    // forever. It cannot happen with a stream-backed response, but the deadlock is worth ruling out.
    if (!registered.body) throw new Error('failed to open the run stream')

    return startedPromise
}
