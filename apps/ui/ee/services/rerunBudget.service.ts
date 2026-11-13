import type { RerunTier } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export type WorkspaceBudget = {
    workspaceId: number
    budgetMicros: number
    usedMicros: number
    // Credit that does not reset with the month: the signup allowance, and anything granted by
    // hand. Spent only once the monthly budget is exhausted.
    topupMicros: number
    periodAnchor: string | null
    currentPeriodEnd: string | null
    // A member paused the credit: nothing may spend it until someone resumes it.
    paused: boolean
}

// The 402 body of a call refused because the credit is paused, so it is never read as used up.
export const RERUN_CREDIT_PAUSED_ERROR = 'rerun_credit_paused'

// The Rerun credit of one workspace. The foreman reaches it straight from the session,
// where a box asks for it through its engine key.
export async function getWorkspaceBudget(workspaceId: number): Promise<WorkspaceBudget | null> {
    const supabase = createServiceRoleClient()
    const { data: ws } = await selectMaybeSingle(supabase, 'workspaces', ['id', 'rerun_budget_micros', 'rerun_used_micros', 'rerun_topup_micros', 'rerun_period_anchor', 'current_period_end', 'rerun_credit_paused_at'] as const, { id: workspaceId })
    if (!ws) return null

    return {
        workspaceId: ws.id,
        budgetMicros: ws.rerun_budget_micros ?? 0,
        usedMicros: ws.rerun_used_micros ?? 0,
        topupMicros: ws.rerun_topup_micros ?? 0,
        periodAnchor: ws.rerun_period_anchor,
        currentPeriodEnd: ws.current_period_end,
        paused: ws.rerun_credit_paused_at !== null,
    }
}

// Resolve the workspace budget from the Rerun proxy bearer token, which is the engine's
// RERUN_API_KEY: the same identity it proves on every other hub door.
export async function getWorkspaceBudgetByEngineKey(token: string): Promise<WorkspaceBudget | null> {
    const engine = await authenticateEngineToken(token)
    if (!engine) return null

    return getWorkspaceBudget(engine.workspaceId)
}

function addOneMonth(iso: string): number {
    const d = new Date(iso)
    d.setMonth(d.getMonth() + 1)
    return d.getTime()
}

// Lazy monthly reset: a safety net for the gap between Stripe webhooks and for
// non-Stripe (invitation-code) workspaces that never receive a renewal event.
// Anchored purely on a rolling month from rerun_period_anchor, which the reset
// self-advances so it fires at most once per month. It must NOT key off
// current_period_end: that date is the webhook's job to advance, and a stale
// (past) value would otherwise wipe usage on every request.
export async function ensureCurrentPeriod(budget: WorkspaceBudget): Promise<WorkspaceBudget> {
    // A workspace that never went through a Stripe renewal (retired invitation code, admin comp) carries no
    // anchor, and without one the reset below can never fire: its credit would be spent once and
    // never refill. Stamp one and leave the usage alone, so the first month starts here.
    if (!budget.periodAnchor) return stampPeriod(budget, false)
    if (Date.now() < addOneMonth(budget.periodAnchor)) return budget

    return stampPeriod(budget, true)
}

// The counter is only written when it is being reset: rewriting the value we read would clobber the
// increment of a call that settled in between.
async function stampPeriod(budget: WorkspaceBudget, reset: boolean): Promise<WorkspaceBudget> {
    const supabase = createServiceRoleClient()
    const anchor = new Date().toISOString()
    const update: Database['public']['Tables']['workspaces']['Update'] = reset ? { rerun_used_micros: 0, rerun_period_anchor: anchor } : { rerun_period_anchor: anchor }

    await supabase.from('workspaces').update<Database['public']['Tables']['workspaces']['Update']>(update).eq('id', budget.workspaceId)
    return { ...budget, usedMicros: reset ? 0 : budget.usedMicros, periodAnchor: anchor }
}

// The month's budget first, then the top-up. `consume_rerun_credit` takes the top-up down as it
// spends it, so what is left of the month cannot be counted against the whole of it: past the
// budget, the top-up is the remainder on its own.
export function remainingMicros(budget: WorkspaceBudget): number {
    return Math.max(budget.budgetMicros - budget.usedMicros, 0) + budget.topupMicros
}

export function hasRemainingBudget(budget: WorkspaceBudget): boolean {
    return remainingMicros(budget) > 0
}

// A one-off credit that survives the monthly reset. The signup allowance goes through here.
export async function grantRerunTopup(workspaceId: number, micros: number): Promise<void> {
    await createServiceRoleClient().rpc('grant_rerun_topup', { p_workspace_id: workspaceId, p_micros: micros })
}

// engineAgentId is the coworker that made the call, null when the box did not say.
type RerunUsage = { workspaceId: number; engineAgentId?: string | null; model: string; tier: RerunTier; inputTokens: number; outputTokens: number; costMicros: number }

export async function recordRerunUsage(params: RerunUsage): Promise<void> {
    // Spends the month's budget first and falls through to the top-up, which is what keeps a
    // signup allowance from being wiped by the plan's budget landing on the row.
    await createServiceRoleClient().rpc('consume_rerun_credit', { p_workspace_id: params.workspaceId, p_micros: params.costMicros })
    await insertRerunUsage(params, true)
}

// What Rerun paid OpenRouter, without taking it off the workspace's credit: the onboarding foreman
// is on the house, and the admin stats still count what it cost.
export async function logRerunUsage(params: RerunUsage): Promise<void> {
    await insertRerunUsage(params, false)
}

async function insertRerunUsage(params: RerunUsage, billed: boolean): Promise<void> {
    await createServiceRoleClient()
        .from('rerun_usage_events')
        .insert<Database['public']['Tables']['rerun_usage_events']['Insert']>({
            workspace_id: params.workspaceId,
            engine_agent_id: params.engineAgentId ?? null,
            billed,
            model: params.model,
            tier: params.tier,
            input_tokens: params.inputTokens,
            output_tokens: params.outputTokens,
            cost_micros: params.costMicros,
        })
}

// A paid data call: what Treg charged us and what the workspace is billed for it, off the same
// credit as the models. A call nobody was charged for is still recorded, a miss is worth seeing.
export async function recordPaidDataUsage(event: Database['public']['Tables']['paid_data_events']['Insert']): Promise<void> {
    const supabase = createServiceRoleClient()
    if (event.billed_micros) await supabase.rpc('consume_rerun_credit', { p_workspace_id: event.workspace_id, p_micros: event.billed_micros })
    await supabase.from('paid_data_events').insert<Database['public']['Tables']['paid_data_events']['Insert']>(event)
}
