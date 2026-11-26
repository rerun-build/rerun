import { actorFromContext, visibleAgentIds } from '@/app/api/_auth/access'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { listMemberProfiles } from '@/app/api/_services/members.service'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { EngineRequestError, listUsageRuns } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll } from '@/supabase/supabase-helpers'
import type { AgentKind, UsageRun, UsageRunsQuery } from '@rerun/contracts'

const USAGE_AGENT_COLUMNS = ['id', 'name', 'kind', 'engine_agent_id'] as const

// The machine runs an engine from before the usage dashboard: it has no `/usage/runs` to read.
export class UsageNotSupportedError extends Error {
    constructor() {
        super('the workspace engine does not answer the usage dashboard yet')
        this.name = 'UsageNotSupportedError'
    }
}

export type UsageCoworker = { id: string; name: string; kind: AgentKind }
export type UsagePerson = { id: string; name: string | null; avatarUrl: string | null }

// A run read by the hub: `coworkerId` is the coworker's id in the app, and so is `starterId` when
// another coworker started it.
export type WorkspaceUsageRun = Omit<UsageRun, 'agentId'> & { coworkerId: string }

export type WorkspaceUsage = { runs: WorkspaceUsageRun[]; coworkers: UsageCoworker[]; people: UsagePerson[]; truncated: boolean }

// The runs of the coworkers the member reaches, every one of them, with who started each. A run of
// a coworker the member does not reach, or of one that is gone, stays out of the totals. A member
// kept out of some Box asks the engine for their coworkers alone, so the others never fill its cap.
export async function readWorkspaceUsage(ctx: WorkspaceContext, query: UsageRunsQuery): Promise<WorkspaceUsage> {
    const conn = await getWorkspaceConnection(ctx.workspace.id)
    const [visible, { data: agents }, profiles] = await Promise.all([
        visibleAgentIds(actorFromContext(ctx)),
        selectAll(createServiceRoleClient(), 'agents', USAGE_AGENT_COLUMNS, { workspace_id: ctx.workspace.id }),
        listMemberProfiles(ctx),
    ])
    const reached = (agents ?? []).filter(agent => agent.engine_agent_id && (visible === 'all' || visible.has(agent.id)))
    const byEngineId = new Map(reached.map(agent => [agent.engine_agent_id!, agent]))
    const { runs, truncated } = await listUsageRuns(conn, query, visible === 'all' ? undefined : [...byEngineId.keys()]).catch(err => {
        throw err instanceof EngineRequestError && err.status === 404 ? new UsageNotSupportedError() : err
    })

    const usageRuns = runs.flatMap(({ agentId, ...run }): WorkspaceUsageRun[] => {
        const coworker = byEngineId.get(agentId)
        if (!coworker) return []
        const starterId = run.starterKind === 'coworker' && run.starterId ? (byEngineId.get(run.starterId)?.id ?? null) : run.starterId
        return [{ ...run, coworkerId: coworker.id, starterId }]
    })

    return {
        runs: usageRuns,
        coworkers: reached.map(agent => ({ id: agent.id, name: agent.name, kind: agent.kind })),
        people: profiles.map(profile => ({ id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl })),
        truncated,
    }
}
