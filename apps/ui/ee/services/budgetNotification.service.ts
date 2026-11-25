import 'server-only'
import type { Database } from '@/app/api/database.types'
import { APP_URL } from '@/lib/app-url'
import { alertBanner, BANNER_WARM_BACKGROUND_MS } from '@/lib/email/board-banner'
import { emailDateLabel } from '@/lib/email/date-labels'
import { BUDGET_EXHAUSTED_EVENT, BUDGET_NOTICE_WINDOW_MS, RERUN_BUDGET_ERROR_CODE, decideBudgetNotice } from '@/lib/notifications/budget-notice'
import type { NotificationReason } from '@/lib/notifications/routing'
import { causeAlertBoard } from '@/lib/og/alert-crew'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { adminsToAlert, sendAlert } from '@/app/api/_services/admin-alert.service'
import { creditResetsAt, getWorkspaceBudget } from '@/ee/services/rerunBudget.service'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import { sendBudgetExhaustedEmail } from '@/app/api/_services/email.service'
import type { NoticeCopy } from '@/lib/notifications/notice-copy'

type NotificationInsert = Database['public']['Tables']['notifications']['Insert']

/**
 * One workspace-level notice per 24h window instead of one error email per failing occurrence.
 * Called from the LLM proxy's 402 path after the response is flushed, so it must never throw and
 * its steady-state cost per 402 is the single dedup select.
 */
export async function notifyBudgetExhausted(workspaceId: number): Promise<void> {
    try {
        const supabase = createServiceRoleClient()

        // `selectMany` with limit 1 rather than `maybeSingle`: a race can leave two notice rows,
        // which must read as "recent notice exists", not as an error.
        const since = new Date(Date.now() - BUDGET_NOTICE_WINDOW_MS).toISOString()
        const { data: recent, error: recentError } = await selectMany(
            supabase,
            'notifications',
            ['id'] as const,
            { workspace_id: workspaceId, event: BUDGET_EXHAUSTED_EVENT, created_at: { gte: since } },
            { column: 'created_at', ascending: false },
            1,
        )
        if (recentError) throw new Error(recentError.message)

        const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['id', 'name', 'is_sandbox', 'subscription_status'] as const, { id: workspaceId })
        if (!workspace) return

        const { insert, email } = decideBudgetNotice({ recentNoticeExists: (recent?.length ?? 0) > 0, isSandbox: workspace.is_sandbox })
        if (!insert) return

        const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId })
        const recipients = Object.fromEntries((members ?? []).map(member => [member.user_id, 'workspace' satisfies NotificationReason]))

        const { error: insertError } = await supabase.from('notifications').insert<NotificationInsert>({
            workspace_id: workspaceId,
            space_id: null,
            agent_id: null,
            engine_agent_id: null,
            event: BUDGET_EXHAUSTED_EVENT,
            kind: 'error',
            message: 'Your Rerun credits for this month are used up. Scheduled and triggered runs on Rerun models are paused, and coworkers cannot buy leads, SEO or social data, until they reset or you add credits.',
            metadata: { errorCode: RERUN_BUDGET_ERROR_CODE, notice: { key: 'budgetExhausted' } satisfies NoticeCopy } as unknown as NotificationInsert['metadata'],
            recipients,
            notified_at: new Date().toISOString(),
        })
        if (insertError) throw new Error(insertError.message)

        if (email && isSubscriptionEntitled(workspace.subscription_status)) await emailAdmins(supabase, workspaceId, workspace.name)
    } catch (err) {
        console.error('[notification] budget exhausted notice failed', err)
    }
}

// Credits are an admin's to top up, so the mail goes to them alone; everyone sees the notice in the app.
// One per month of credit, however many days go by without any: the notice of the day is the app's.
async function emailAdmins(supabase: ReturnType<typeof createServiceRoleClient>, workspaceId: number, workspaceName: string | null): Promise<void> {
    const budget = await getWorkspaceBudget(workspaceId)
    if (!budget || !(await everHadCredit(supabase, workspaceId, budget.budgetMicros))) return

    const resetsAt = creditResetsAt(budget)
    const alert = { workspaceId, key: `workspace:${workspaceId}:credits:${resetsAt?.toISOString().slice(0, 10) ?? 'once'}:${budget.budgetMicros}` }
    const adminIds = await adminsToAlert(supabase, alert)
    if (!adminIds.length) return

    // Run after the 402 response is flushed, so nobody waits on the capture.
    const boardUrl = await alertBanner(causeAlertBoard(supabase, workspaceId, 'credits'), BANNER_WARM_BACKGROUND_MS)
    await sendAlert(supabase, alert, adminIds, ({ to, locale, unsubscribeUrl }) =>
        sendBudgetExhaustedEmail({ to, workspaceName, resetLabel: resetsAt ? emailDateLabel(resetsAt, locale) : undefined, creditsUrl: `${APP_URL}/?${WORKSPACE_PARAM}=${workspaceId}&billing=1`, boardUrl, unsubscribeUrl, locale }),
    )
}

// A lifetime workspace runs on its own keys and never had a credit to run out of.
async function everHadCredit(supabase: ReturnType<typeof createServiceRoleClient>, workspaceId: number, budgetMicros: number): Promise<boolean> {
    if (budgetMicros > 0) return true
    const { data: spent } = await selectCount(supabase, 'rerun_usage_events', { workspace_id: workspaceId, billed: true })
    return (spent ?? 0) > 0
}
