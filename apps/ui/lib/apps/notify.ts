// No 'server-only': the archive, restore and trial sweeps that call this run as Trigger.dev tasks.
import * as React from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppNotice as AppNoticeEmail, renderEmail } from '@rerun/emails'
import { emailTranslator } from '@rerun/emails/i18n'
import { selectWorkspaceMembers } from '@/app/api/_auth/workspace-members'
import type { Database } from '@/app/api/database.types'
import { brandAppUrl } from '@/lib/brand/urls'
import { workspaceBrand } from '@/lib/brand/workspace'
import { getResendClient, redirectDelivery } from '@/lib/email/client'
import { emailSender } from '@/lib/email/sender'
import { sendThrottled } from '@/lib/email/throttle'
import { buildUnsubscribeUrl, listUnsubscribeHeaders } from '@/lib/email/unsubscribeToken'
import { loadRecipient } from '@/ee/lib/lifecycle/recipient'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { noticeText, type NoticeCopy } from '@/lib/notifications/notice-copy'
import { wantsCategoryEmail } from '@/lib/notifications/prefs'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type NotificationInsert = Database['public']['Tables']['notifications']['Insert']

export const APP_NOTICE_EVENT = 'app_notice'

export type AppNotice = {
    appName: string
    message: string
    copy: NoticeCopy
    // Who hears about it by email on top of the bell: a fact that costs money or stops the coworkers
    // is worth an email, a reconnect reminder after a restore is not.
    email: boolean
}

// The bell for the whole workspace, and an email to the members who keep billing emails on. Never
// throws: a notice that fails must not undo the change it reports.
export async function notifyWorkspace(supabase: Client, workspaceId: number, notice: AppNotice): Promise<void> {
    try {
        // Slots, trials and what they cost: an organization's workspaces are sold none of it.
        const { data: workspace, error: workspaceError } = await selectMaybeSingle(supabase, 'workspaces', ['organization_id'] as const, { id: workspaceId })
        if (workspaceError) throw new Error(workspaceError.message)
        if (isManagedWorkspace(workspace)) return

        const { error } = await supabase.from('notifications').insert<NotificationInsert>({
            workspace_id: workspaceId,
            space_id: null,
            agent_id: null,
            engine_agent_id: null,
            event: APP_NOTICE_EVENT,
            kind: 'connector',
            message: notice.message,
            metadata: { app: notice.appName, notice: notice.copy },
            notified_at: new Date().toISOString(),
        })
        if (error) throw new Error(error.message)
        if (notice.email) await emailMembers(supabase, workspaceId, notice)
    } catch (err) {
        console.error(`[apps] notice to workspace ${workspaceId} failed`, err)
    }
}

async function emailMembers(supabase: Client, workspaceId: number, notice: AppNotice): Promise<void> {
    const resend = getResendClient()
    if (!resend) return

    const { data: admins } = await selectWorkspaceMembers(supabase, ['user_id'] as const, { workspace_id: workspaceId, role: 'admin' })
    const userIds = (admins ?? []).map(admin => admin.user_id)
    if (userIds.length === 0) return
    const { data: users } = await selectMany(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: userIds })
    const recipients = (users ?? []).filter(user => wantsCategoryEmail(user.email_notification_prefs, 'billing'))

    const brand = await workspaceBrand(workspaceId)
    const appUrl = brandAppUrl(brand)

    await Promise.allSettled(
        recipients.map(async user => {
            const recipient = await loadRecipient(supabase, user.id)
            if (!recipient) return
            const locale = await recipientLocale(supabase, user.id, workspaceId)
            const unsubscribeUrl = `${buildUnsubscribeUrl(user.id, appUrl)}&category=billing`
            const subject = emailTranslator(locale, brand.name)('subjects.appNotice', { appName: notice.appName })
            const message = noticeText({ message: notice.message, metadata: { notice: notice.copy } }, await translatorFor(locale, 'notifications.notices', brand.name))
            const { html, text } = await renderEmail(React.createElement(AppNoticeEmail, { appName: notice.appName, message, appUrl, unsubscribeUrl, locale, brand }))
            const delivery = redirectDelivery(recipient.email, subject)
            await sendThrottled(() => resend.emails.send({ ...emailSender(brand), to: delivery.to, subject: delivery.subject, html, text, headers: listUnsubscribeHeaders(unsubscribeUrl) }))
        }),
    )
}
