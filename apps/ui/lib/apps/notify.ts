import * as React from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AgentNotification, renderEmail } from '@rerun/emails'
import { emailTranslator } from '@rerun/emails/i18n'
import type { Database } from '@/app/api/database.types'
import { APP_URL, REPLY_TO, TRANSACTIONAL_FROM, getResendClient, redirectDelivery } from '@/lib/email/client'
import { sendThrottled } from '@/lib/email/throttle'
import { buildUnsubscribeUrl, listUnsubscribeHeaders } from '@/lib/email/unsubscribeToken'
import { loadRecipient } from '@/lib/auth/recipient'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { noticeText, type NoticeCopy } from '@/lib/notifications/notice-copy'
import { wantsCategoryEmail } from '@/lib/notifications/prefs'
import { selectMany } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type NotificationInsert = Database['public']['Tables']['notifications']['Insert']

export const APP_NOTICE_EVENT = 'app_notice'

export type AppNotice = {
    appName: string
    message: string
    copy: NoticeCopy
    email: boolean
}

export async function notifyWorkspace(supabase: Client, workspaceId: number, notice: AppNotice): Promise<void> {
    try {
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

    const { data: admins } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceId, role: 'admin' })
    const userIds = (admins ?? []).map(admin => admin.user_id)
    if (userIds.length === 0) return
    const { data: users } = await selectMany(supabase, 'users', ['id', 'email_notification_prefs'] as const, { id: userIds })
    const recipients = (users ?? []).filter(user => wantsCategoryEmail(user.email_notification_prefs, 'billing'))

    await Promise.allSettled(
        recipients.map(async user => {
            const recipient = await loadRecipient(supabase, user.id)
            if (!recipient) return
            const locale = await recipientLocale(supabase, user.id, workspaceId)
            const unsubscribeUrl = buildUnsubscribeUrl(user.id)
            const subject = emailTranslator(locale)('subjects.appNotice', { appName: notice.appName })
            const message = noticeText({ message: notice.message, metadata: { notice: notice.copy } }, await translatorFor(locale, 'notifications.notices'))
            const { html, text } = await renderEmail(React.createElement(AgentNotification, { agentName: notice.appName, kind: 'connector', message, appUrl: APP_URL, unsubscribeUrl, locale }))
            const delivery = redirectDelivery(recipient.email, subject)
            await sendThrottled(() => resend.emails.send({ from: TRANSACTIONAL_FROM, replyTo: REPLY_TO, to: delivery.to, subject: delivery.subject, html, text, headers: listUnsubscribeHeaders(unsubscribeUrl) }))
        }),
    )
}
