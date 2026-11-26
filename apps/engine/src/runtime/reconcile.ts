import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { failInterruptedRuns, SCRIPT_RUN_SESSION_ID, type InterruptedRun } from '../db/repos/runs.js'
import { listAgentIndex, resetBusyAgents } from '../db/repos/agents.js'
import { failInterruptedSkillProposals } from '../db/repos/skill-proposals.js'
import { systemDbExists } from '../db/systemDb.js'
import { remoteComputersEnabled } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { emitRunTerminal, triggerFromRun } from './run-events.js'
import { RUN_ERROR_CODES } from './provider-errors.js'

// A restart after a long outage would otherwise announce every run it ever interrupted, one
// notification and one email per conversation.
const NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000
const NOTIFY_LIMIT = 20

export type Reconciliation = { runs: number; agents: number; notified: number; proposals: number }

export async function reconcileInterruptedRuns(now = Date.now()): Promise<Reconciliation> {
    const interrupted: Array<InterruptedRun & { agentId: string }> = []
    let proposals = 0
    // The foreman is kept out of the index, so it is named here or its interrupted runs stay
    // `running` forever.
    const agentIds = [...(await listAgentIndex()).map(agent => agent.id), FOREMAN_AGENT_ID]
    for (const agentId of agentIds) {
        if (!systemDbExists(agentId)) continue
        for (const run of await failInterruptedRuns(agentId, { keepOpenScriptJobs: remoteComputersEnabled() })) interrupted.push({ ...run, agentId })
        proposals += await failInterruptedSkillProposals(agentId)
    }
    const agents = await resetBusyAgents()

    // Repairing SQLite is not enough: the dashboard reads the conversation status from the hub, and
    // without this the session stays "working" until someone stops a run that no longer exists.
    const recent = interrupted
        .filter(run => now - new Date(run.startedAt).getTime() < NOTIFY_WINDOW_MS)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, NOTIFY_LIMIT)
    for (const run of recent) {
        await emitRunTerminal({
            agentId: run.agentId,
            sessionId: run.sessionId,
            runId: run.id,
            trigger: triggerFromRun(run),
            kind: 'error',
            error: 'interrupted: engine restarted',
            errorCode: RUN_ERROR_CODES.engineRestarted,
            // So its notification opens the routine: a script's run has no conversation.
            script: run.sessionId === SCRIPT_RUN_SESSION_ID ? { exitCode: null, timedOut: false, notify: 'always' } : undefined,
        })
    }

    logger.info({ runs: interrupted.length, agents, notified: recent.length, proposals }, 'reconciled interrupted state on startup')
    return { runs: interrupted.length, agents, notified: recent.length, proposals }
}
