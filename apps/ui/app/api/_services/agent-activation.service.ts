import type { Database } from '@/app/api/database.types'
import { patchAgent as enginePatchAgent } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectSingle } from '@/supabase/supabase-helpers'
import { pauseAgentSchedules, resumeAgentSchedules } from './agent.service'
import { PLAN_LIMIT_REASON, activeAgentLimit, hasFreeAgentSlot, isPlanLimited } from './capacity.service'
import { getSpaceConnection } from './space.service'
import { AppError } from '@/lib/i18n/action-error'

type AgentUpdate = Database['public']['Tables']['agents']['Update']

export async function reconcileAgentActivation(workspaceId: number): Promise<string[]> {
    const limit = await activeAgentLimit(workspaceId)
    if (limit === null) return []

    const supabase = createServiceRoleClient()
    const { data: active } = await selectAll(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, disabled_at: { isNull: true } }, { column: 'created_at', ascending: true })

    const excess = (active ?? []).slice(limit).map(agent => agent.id)
    if (excess.length === 0) return []

    await supabase
        .from('agents')
        .update<AgentUpdate>({ disabled_at: new Date().toISOString(), disabled_reason: PLAN_LIMIT_REASON })
        .in('id', excess)

    return excess
}

export async function wakePlanLimitedAgents(workspaceId: number): Promise<{ woken: string[]; active: string[] }> {
    const limit = await activeAgentLimit(workspaceId)
    if (limit === 0) return { woken: [], active: [] }

    const supabase = createServiceRoleClient()
    const [{ data: active }, { data: switchedOff }] = await Promise.all([
        selectAll(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, disabled_at: { isNull: true } }),
        selectAll(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, disabled_reason: PLAN_LIMIT_REASON }, { column: 'created_at', ascending: true }),
    ])
    const freeSlots = limit === null ? Infinity : Math.max(0, limit - (active ?? []).length)
    const woken = (switchedOff ?? []).slice(0, freeSlots).map(agent => agent.id)

    if (woken.length > 0) await supabase.from('agents').update<AgentUpdate>({ disabled_at: null, disabled_reason: null }).in('id', woken)
    return { woken, active: (active ?? []).map(agent => agent.id) }
}

export async function reactivateAgentsAfterRestore(workspaceId: number): Promise<string[]> {
    const { woken, active } = await wakePlanLimitedAgents(workspaceId)

    for (const agentId of active) await startAgentOnEngine(agentId)
    for (const agentId of woken) await startAgentOnEngine(agentId)
    return woken
}

export const NO_FREE_SLOT_ERROR = 'No free coworker slot on your plan. Start Pro for unlimited coworkers, or delete a coworker to make room.'

export async function activateAgent(agentId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['workspace_id', 'disabled_at', 'disabled_reason'] as const, { id: agentId })
    if (!agent) throw new AppError('coworkerNotFound')
    if (!agent.disabled_at) return
    if (!isPlanLimited(agent.disabled_reason)) throw new AppError('templateSubscriptionEnded')
    if (!(await hasFreeAgentSlot(agent.workspace_id))) throw new AppError('noFreeCoworkerSlot')

    await supabase.from('agents').update<AgentUpdate>({ disabled_at: null, disabled_reason: null }).eq('id', agentId)

    await startAgentOnEngine(agentId)
}

export async function stopAgentsOnEngine(agentIds: string[]): Promise<void> {
    for (const agentId of agentIds) {
        await attempt(`pause the schedules of ${agentId}`, () => pauseAgentSchedules(agentId))
        await attempt(`switch off ${agentId}`, () => setEngineAgentEnabled(agentId, false))
    }
}

export async function startAgentOnEngine(agentId: string): Promise<void> {
    await attempt(`switch on ${agentId}`, () => setEngineAgentEnabled(agentId, true))
    await attempt(`resume the schedules of ${agentId}`, () => resumeAgentSchedules(agentId))
}

async function attempt(what: string, run: () => Promise<void>): Promise<void> {
    try {
        await run()
    } catch (err) {
        console.error(`[activation] failed to ${what}`, err)
    }
}

export async function setEngineAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: agent } = await selectSingle(supabase, 'agents', ['engine_agent_id', 'space_id'] as const, { id: agentId })
    if (!agent?.engine_agent_id) return

    const conn = await getSpaceConnection(agent.space_id)
    await enginePatchAgent(conn, agent.engine_agent_id, { enabled })
}
