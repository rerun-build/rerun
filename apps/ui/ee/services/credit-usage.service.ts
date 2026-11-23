import type { SupabaseClient } from '@supabase/supabase-js'

import { AccessDeniedError, isAdminActor, type Actor } from '@/app/api/_auth/access'
import { ADMIN_ONLY } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { addOneMonth } from '@/ee/lib/billing/cancel-flow'
import { summarizeCreditUsage, type CreditUsage } from '@/ee/lib/billing/credit-usage'
import { selectAll, selectSingle } from '@/supabase/supabase-helpers'

const DAY_MS = 86_400_000

type PeriodColumns = { rerun_period_anchor: string | null; subscription_status: string | null; trial_ends_at: string | null }

// The stretch the credit is counted over: the month since the anchor, or the trial since it began.
// A workspace with no anchor yet is shown its last thirty days.
export function creditPeriod({ rerun_period_anchor, subscription_status, trial_ends_at }: PeriodColumns, now: Date): { start: Date; end: Date } {
    const start = rerun_period_anchor ? new Date(rerun_period_anchor) : new Date(now.getTime() - 30 * DAY_MS)
    const end = subscription_status === 'trialing' && trial_ends_at ? new Date(trial_ends_at) : rerun_period_anchor ? addOneMonth(start) : now
    return { start, end: end > start ? end : now }
}

// Billing, and a spend per coworker across every Box: an admin's to read.
export async function getCreditUsage(supabase: SupabaseClient<Database>, actor: Actor, now = new Date()): Promise<CreditUsage> {
    if (!isAdminActor(actor)) throw new AccessDeniedError(ADMIN_ONLY)
    const { workspaceId } = actor
    const { data: workspace } = await selectSingle(supabase, 'workspaces', ['rerun_period_anchor', 'subscription_status', 'trial_ends_at'] as const, { id: workspaceId })
    const period = creditPeriod(workspace ?? { rerun_period_anchor: null, subscription_status: null, trial_ends_at: null }, now)

    const [{ data: rows, error }, { data: agents }] = await Promise.all([supabase.rpc('rerun_credit_usage', { p_workspace_id: workspaceId, p_since: period.start.toISOString() }), selectAll(supabase, 'agents', ['id', 'name', 'engine_agent_id'] as const, { workspace_id: workspaceId, kind: 'coworker', engine_agent_id: { notNull: true } })])
    if (error) throw new Error(error.message)

    return summarizeCreditUsage(rows ?? [], agents ?? [], period, now)
}
