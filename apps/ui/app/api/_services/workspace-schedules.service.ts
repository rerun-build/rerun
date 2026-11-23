import { keepVisible, visibleSpaceIds, type Actor } from '@/app/api/_auth/access'
import type { AgentSchedule } from '@/lib/board/next-runs'
import { listSchedules } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle, selectMany } from '@/supabase/supabase-helpers'
import { findWorkspaceEngine } from './workspace-engine.service'

// The engine only lists schedules per agent, so this fans out over the workspace's agents on its one
// machine. An agent whose call fails drops out rather than emptying the whole board. Only the agents
// in the Boxes the caller reaches.
export async function listWorkspaceSchedules(actor: Actor): Promise<AgentSchedule[]> {
    const { workspaceId } = actor
    const supabase = createServiceRoleClient()
    const [{ data: agents }, { data: workspace }, spaces] = await Promise.all([
        selectMany(supabase, 'agents', ['id', 'engine_agent_id', 'disabled_at', 'space_id'] as const, { workspace_id: workspaceId, kind: 'coworker' }),
        selectMaybeSingle(supabase, 'workspaces', ['boxes_disabled_at', 'boxes_archived_at'] as const, { id: workspaceId }),
        visibleSpaceIds(actor),
    ])

    const runnable = keepVisible(agents ?? [], spaces, agent => agent.space_id).filter(agent => agent.engine_agent_id && !agent.disabled_at)
    if (runnable.length === 0 || workspace?.boxes_disabled_at || workspace?.boxes_archived_at) return []

    const engine = await findWorkspaceEngine(workspaceId)
    if (!engine) return []

    const perAgent = await Promise.allSettled(
        runnable.map(async agent => {
            const schedules = await listSchedules(engine.conn, agent.engine_agent_id as string)
            return schedules.map(({ slug, name, cron, runAt, timezone, enabled, lastRunAt }): AgentSchedule => ({ agentId: agent.id, slug, name, cron, runAt, timezone, enabled, lastRunAt }))
        })
    )
    return perAgent.flatMap(result => (result.status === 'fulfilled' ? result.value : []))
}
