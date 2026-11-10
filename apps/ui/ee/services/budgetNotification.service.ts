import 'server-only'
import { realEmail } from '@/lib/auth/placeholder-email'
import type { Database } from '@/app/api/database.types'
import { BANNER_WARM_BACKGROUND_MS, emailBoardBanner } from '@/lib/email/board-banner'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribeToken'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { BUDGET_EXHAUSTED_EVENT, BUDGET_NOTICE_WINDOW_MS, RERUN_BUDGET_ERROR_CODE, decideBudgetNotice } from '@/lib/notifications/budget-notice'
import { NOTIFICATION_EMAILS_PAUSED, wantsCategoryEmail } from '@/lib/notifications/prefs'
import type { NotificationReason } from '@/lib/notifications/routing'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
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

        const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['id', 'name', 'is_sandbox'] as const, { id: workspaceId })
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

        if (!email || NOTIFICATION_EMAILS_PAUSED) return
        await emailWorkspaceMembers(supabase, workspaceId, workspace.name)
    } catch (err) {
        console.error('[notification] budget exhausted notice failed', err)
    }
}

// Credits are an admin's to top up, so the mail goes to them alone; everyone sees the notice in the app.
async function emailWorkspaceMembers(supabase: ReturnType<typeof createServiceRoleClient>, workspaceId: number, workspaceName: string | null): Promise<void> {
    const { data: admins } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, role: 'admin' })
    const adminIds = (admins ?? []).map(admin => admin.user_id)
    if (!adminIds.length) return
    const { data: members } = await selectMany(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: adminIds })
    const recipients = (members ?? []).filter(member => wantsCategoryEmail(member.email_notification_prefs, 'billing'))
    if (!recipients.length) return

    // Run after the 402 response is flushed, so nobody waits on the capture.
    const boardUrl = await emailBoardBanner(supabase, workspaceId, 'offline', BANNER_WARM_BACKGROUND_MS)
    await Promise.allSettled(
        recipients.map(async member => {
            const { data } = await supabase.auth.admin.getUserById(member.id)
            const to = realEmail(data.user?.email)
            if (!to) return
            // Scope-less token: this is an account-category email, not a run notification.
            const locale = await recipientLocale(supabase, member.id, workspaceId)
            await sendBudgetExhaustedEmail({ to, workspaceName, boardUrl, unsubscribeUrl: buildUnsubscribeUrl(member.id), locale })
        }),
    )
}
