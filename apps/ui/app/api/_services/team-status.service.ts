import { fetchLiveSessions } from '@/lib/board/live-sessions'
import { isWaitingOnHuman, teamMemberStatus } from '@/lib/board/team-status'
import { listRuns } from '@/lib/engine/client'
import type { EngineConnection, EngineRun } from '@/lib/engine/types'
import { projectRun } from '@/lib/mcp/run-projection'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { findWorkspaceEngine } from './workspace-engine.service'

const TEAM_AGENT_COLUMNS = ['id', 'name', 'handle', 'space_id', 'engine_agent_id', 'disabled_at'] as const
const MAX_RUNNING_PER_AGENT = 20
const RECENT_RUNS = 5

type AgentRuns = { running: EngineRun[]; lastFinished: EngineRun | null }

async function readAgentRuns(conn: EngineConnection, engineAgentId: string): Promise<AgentRuns | null> {
    try {
        const [running, recent] = await Promise.all([listRuns(conn, engineAgentId, { status: 'running', limit: MAX_RUNNING_PER_AGENT }), listRuns(conn, engineAgentId, { limit: RECENT_RUNS })])
        return { running, lastFinished: recent.find(run => run.status !== 'running') ?? null }
    } catch {
        return null
    }
}

export async function readTeamStatus(workspaceId: number, { spaceId, agentId }: { spaceId?: string; agentId?: string } = {}) {
    const supabase = createServiceRoleClient()
    const [{ data: agents }, { data: workspace }] = await Promise.all([selectMany(supabase, 'agents', TEAM_AGENT_COLUMNS, { workspace_id: workspaceId, ...(spaceId ? { space_id: spaceId } : {}), ...(agentId ? { id: agentId } : {}) }, { column: 'created_at' }), selectMaybeSingle(supabase, 'workspaces', ['boxes_disabled_at', 'boxes_archived_at'] as const, { id: workspaceId })])
    const checkedAt = new Date().toISOString()
    if (!agents?.length) return { checkedAt, agents: [] }

    const machineDown = !!(workspace?.boxes_disabled_at || workspace?.boxes_archived_at)
    const engine = machineDown ? null : await findWorkspaceEngine(workspaceId)
    const [runsByAgent, sessions] = await Promise.all([
        Promise.all(agents.map(agent => (engine && agent.engine_agent_id && !agent.disabled_at ? readAgentRuns(engine.conn, agent.engine_agent_id) : Promise.resolve(null)))),
        fetchLiveSessions(supabase, agents.map(agent => agent.id)),
    ])

    return {
        checkedAt,
        agents: agents.map((agent, index) => {
            const runs = runsByAgent[index]
            const waitingOn = (sessions ?? []).filter(session => session.agentId === agent.id && isWaitingOnHuman(session.status)).map(session => ({ sessionId: session.id, reason: session.status }))
            const status = teamMemberStatus({
                switchedOff: !!agent.disabled_at,
                configured: !!agent.engine_agent_id,
                reachable: !!runs,
                runningCount: runs?.running.length ?? 0,
                waitingCount: waitingOn.length,
                lastFinishedStatus: runs?.lastFinished?.status ?? null,
            })
            const lastRun = runs?.lastFinished ? projectRun(runs.lastFinished) : null
            return {
                id: agent.id,
                name: agent.name,
                handle: agent.handle,
                spaceId: agent.space_id,
                status,
                running: (runs?.running ?? []).map(projectRun).map(run => ({ runId: run.runId, sessionId: run.sessionId, trigger: run.trigger, startedAt: run.startedAt, steps: run.steps })),
                waitingOn,
                lastRun: lastRun && { runId: lastRun.runId, status: lastRun.status, finishedAt: lastRun.finishedAt, error: lastRun.error },
            }
        }),
    }
}
