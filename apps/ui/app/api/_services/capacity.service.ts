import { activeAgentLimitFor, isSubscriptionEntitled } from '@rerun/cloud/billing'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectSingle } from '@/supabase/supabase-helpers'
import { AppError } from '@/lib/i18n/action-error'

// The plan caps how many agents can be *active*, not how many exist: a workspace may hold as many
// agents as it likes, and the ones beyond the limit sit disabled until a slot frees up. So the
// server authority here answers "is there a free slot", never "may this agent be created".
// Boxes are free: they arrange agents on the board and cost nothing. The machine is what still
// costs money, and a workspace gets exactly one.

// `agents.disabled_reason` records the cause: this one means "there was no slot for it", which a
// paid plan or a freed slot can fix. The other producer is a template revocation, which cannot.
export const PLAN_LIMIT_REASON = 'plan_limit'

export function isPlanLimited(disabledReason: string | null): boolean {
    return disabledReason === null || disabledReason === PLAN_LIMIT_REASON
}

// The snapshotted column is not the answer on its own: a trial is capped below it, and a
// subscription that is really over collapses it to zero. `past_due` keeps its full allowance: a
// declined charge archives the machine, and the agents have to come back as they were once it is paid.
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

// How many more agents can start active, for a batch that decides every agent's flag up front
// rather than re-counting between two creations it runs at once.
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

// The board only offers a Box to an entitled workspace, but the action is callable on its own and
// the first Box is what claims a real machine: without this, a signup with no subscription at all
// takes one out of the pool.
export async function assertEngineEntitlement(workspaceId: number): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['subscription_status'] as const, { id: workspaceId })
    if (!isSubscriptionEntitled(workspace?.subscription_status)) throw new NoPlanError()
}
