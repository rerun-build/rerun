import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import type { RoutedMember, NotificationRecipients } from '@/lib/notifications/routing'
import type { StoredNotification } from '@/lib/notifications/inbound'

export { sendIncidentResolvedEmail, sendNotificationEmail, sendPublishedAccessCodeEmail, sendSignInCodeEmail, sendWorkspaceInviteEmail } from '@/app/api/_services/email.service'
export { BANNER_WARM_BACKGROUND_MS, BANNER_WARM_INLINE_MS, emailBoardBanner } from '@/lib/email/board-banner'
export { buildUnsubscribeUrl, verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'

export const EMAIL_DELIVERY = Boolean(process.env.SMTP_HOST || process.env.RESEND_API_KEY)

export type PushContext = {
    workspaceId: number
    agentId: string | null
    agentName: string
    conversationId: string | null
    sourceKey: string
    notification: StoredNotification
    recipients: NotificationRecipients
    members: RoutedMember[]
}

export async function pushNotification(_supabase: SupabaseClient<Database>, _context: PushContext): Promise<void> {}
