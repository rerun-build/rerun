import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import type { RoutedMember, NotificationRecipients } from '@/lib/notifications/routing'
import type { StoredNotification } from '@/lib/notifications/inbound'

export { sendIncidentResolvedEmail, sendNotificationEmail, sendPublishedAccessCodeEmail, sendSignInCodeEmail, sendWorkspaceInviteEmail } from '@/app/api/_services/email.service'
export { BANNER_WARM_BACKGROUND_MS, BANNER_WARM_INLINE_MS, emailBoardBanner } from '@/lib/email/board-banner'
export { buildUnsubscribeUrl, verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'

// A self-hosted install sends its emails through its own Resend account (RESEND_API_KEY, RESEND_FROM).
// Without one nothing is sent: an invitation hands its link to the person who sent it, and a
// published page cannot invite by code.
export const EMAIL_DELIVERY = Boolean(process.env.RESEND_API_KEY)

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

// The mobile app talks to Rerun Cloud only, so a self-hosted hub has no device to push to.
export async function pushNotification(_supabase: SupabaseClient<Database>, _context: PushContext): Promise<void> {}
