import type { RerunTier } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { isPremiumModelEntitled } from '@/ee/lib/billing/entitlement'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export type WorkspaceBudget = {
    workspaceId: number
    budgetMicros: number
    usedMicros: number
    topupMicros: number
    periodAnchor: string | null
    currentPeriodEnd: string | null
    smartAllowed: boolean
    paused: boolean
}

export const RERUN_CREDIT_PAUSED_ERROR = 'rerun_credit_paused'

export async function getWorkspaceBudget(workspaceId: number): Promise<WorkspaceBudget | null> {
    const supabase = createServiceRoleClient()
    const { data: ws } = await selectMaybeSingle(supabase, 'workspaces', ['id', 'rerun_budget_micros', 'rerun_used_micros', 'rerun_topup_micros', 'rerun_period_anchor', 'current_period_end', 'subscription_status', 'is_sandbox', 'rerun_credit_paused_at'] as const, { id: workspaceId })
    if (!ws) return null

    return {
        workspaceId: ws.id,
        budgetMicros: ws.rerun_budget_micros ?? 0,
        usedMicros: ws.rerun_used_micros ?? 0,
        topupMicros: ws.rerun_topup_micros ?? 0,
        periodAnchor: ws.rerun_period_anchor,
        currentPeriodEnd: ws.current_period_end,
        smartAllowed: isPremiumModelEntitled(ws),
        paused: ws.rerun_credit_paused_at !== null,
    }
}

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

export async function ensureCurrentPeriod(budget: WorkspaceBudget): Promise<WorkspaceBudget> {
    if (!budget.periodAnchor) return stampPeriod(budget, false)
    if (Date.now() < addOneMonth(budget.periodAnchor)) return budget

    return stampPeriod(budget, true)
}

async function stampPeriod(budget: WorkspaceBudget, reset: boolean): Promise<WorkspaceBudget> {
    const supabase = createServiceRoleClient()
    const anchor = new Date().toISOString()
    const update: Database['public']['Tables']['workspaces']['Update'] = reset ? { rerun_used_micros: 0, rerun_period_anchor: anchor } : { rerun_period_anchor: anchor }

    await supabase.from('workspaces').update<Database['public']['Tables']['workspaces']['Update']>(update).eq('id', budget.workspaceId)
    return { ...budget, usedMicros: reset ? 0 : budget.usedMicros, periodAnchor: anchor }
}

export function remainingMicros(budget: WorkspaceBudget): number {
    return Math.max(budget.budgetMicros - budget.usedMicros, 0) + budget.topupMicros
}

export function hasRemainingBudget(budget: WorkspaceBudget): boolean {
    return remainingMicros(budget) > 0
}

export async function grantRerunTopup(workspaceId: number, micros: number): Promise<void> {
    await createServiceRoleClient().rpc('grant_rerun_topup', { p_workspace_id: workspaceId, p_micros: micros })
}

type RerunUsage = { workspaceId: number; engineAgentId?: string | null; model: string; tier: RerunTier; inputTokens: number; outputTokens: number; costMicros: number }

export async function recordRerunUsage(params: RerunUsage): Promise<void> {
    await createServiceRoleClient().rpc('consume_rerun_credit', { p_workspace_id: params.workspaceId, p_micros: params.costMicros })
    await insertRerunUsage(params, true)
}

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

export async function recordPaidDataUsage(event: Database['public']['Tables']['paid_data_events']['Insert']): Promise<void> {
    const supabase = createServiceRoleClient()
    if (event.billed_micros) await supabase.rpc('consume_rerun_credit', { p_workspace_id: event.workspace_id, p_micros: event.billed_micros })
    await supabase.from('paid_data_events').insert<Database['public']['Tables']['paid_data_events']['Insert']>(event)
}
