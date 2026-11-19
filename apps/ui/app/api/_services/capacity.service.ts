import { activeAgentLimitFor, isSubscriptionEntitled } from '@moldwright/cloud/billing'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectSingle } from '@/supabase/supabase-helpers'
import { AppError } from '@/lib/i18n/action-error'

export const PLAN_LIMIT_REASON = 'plan_limit'

export function isPlanLimited(disabledReason: string | null): boolean {
    return disabledReason === null || disabledReason === PLAN_LIMIT_REASON
}

export async function activeAgentLimit(workspaceId: number): Promise<number | null> {
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['max_agents', 'subscription_status'] as const, { id: workspaceId })
    if (!workspace) return 0
    return activeAgentLimitFor(workspace.max_agents, workspace.subscription_status)
}

async function countActiveAgents(workspaceId: number): Promise<number> {
    const supabase = createServiceRoleClient()
    const { data } = await selectCount(supabase, 'agents', { workspace_id: workspaceId, disabled_at: { isNull: true } })
    return data ?? 0
}

export async function hasFreeAgentSlot(workspaceId: number): Promise<boolean> {
    return (await freeAgentSlots(workspaceId)) > 0
}

export async function freeAgentSlots(workspaceId: number): Promise<number> {
    const limit = await activeAgentLimit(workspaceId)
    if (limit === null) return Infinity
    if (limit === 0) return 0
    return Math.max(0, limit - (await countActiveAgents(workspaceId)))
}

export class NoPlanError extends AppError {
    constructor() {
        super('noActivePlan')
        this.name = 'NoPlanError'
    }
}

export async function assertEngineEntitlement(workspaceId: number): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['subscription_status'] as const, { id: workspaceId })
    if (!isSubscriptionEntitled(workspace?.subscription_status)) throw new NoPlanError()
}
