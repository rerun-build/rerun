import type { ModelOverride } from '../agents/providers.js'
import type { LoadedAgent } from '../agents/types.js'
import { startRun } from '../db/repos/runs.js'
import { runAgent, type AgentRun, type RunTrigger } from './loop.js'
import { mergeRunStream } from './run-stream-merge.js'
import { registerRun } from './stream.js'

export async function startHeadlessRun(agent: LoadedAgent, sessionId: string, message: string, override: ModelOverride | undefined, trigger: RunTrigger): Promise<AgentRun> {
    const run = await startRun(agent.id, sessionId)
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

    if (!registered.body) throw new Error('failed to open the run stream')

    return startedPromise
}
