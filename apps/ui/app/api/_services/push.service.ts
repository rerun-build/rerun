import type { Database } from '@/app/api/database.types'
import type { StoredNotification } from '@/lib/notifications/inbound'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { pushCopyOf } from '@/lib/notifications/push-copy'
import { pushAllowed, pushWindowStart } from '@/lib/notifications/push-limits'
import { wantsPush, type NotificationRecipients, type RoutedMember } from '@/lib/notifications/routing'
import { selectCount, selectMany } from '@/supabase/supabase-helpers'
import { ANDROID_PUSH_CHANNELS, type AndroidPushChannel, type PushData } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

type DispatchInsert = Database['public']['Tables']['notification_push_dispatches']['Insert']
type DeviceTokenUpdate = Database['public']['Tables']['device_tokens']['Update']

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

// Expo holds the APNs and FCM credentials, so the hub sends a plain POST rather than keeping an HTTP/2
// connection open to Apple, which a route handler is in no position to do.
type ExpoMessage = { to: string; title: string; subtitle?: string; body?: string; sound?: 'default'; channelId?: AndroidPushChannel; priority?: 'high'; data: PushData }

// On Android the channel, not the message, decides whether a push rings, and a normal-priority FCM
// message waits for a sleeping phone to wake on its own: a question would sit unseen for minutes.
function androidFieldsOf(silent: boolean): Pick<ExpoMessage, 'channelId' | 'priority'> {
    return silent ? { channelId: ANDROID_PUSH_CHANNELS.silent } : { channelId: ANDROID_PUSH_CHANNELS.messages, priority: 'high' }
}

export type PushContext = {
    workspaceId: number
    agentId: string | null
    agentName: string
    // The hub's conversation the notification is about, which the app opens on a tap.
    conversationId: string | null
    sourceKey: string
    notification: StoredNotification
    recipients: NotificationRecipients
    members: RoutedMember[]
}

// Beside the email, and just as best-effort: the notification is already stored, and a push that
// fails to leave must never fail the webhook that recorded it.
export async function pushNotification(supabase: SupabaseClient<Database>, context: PushContext): Promise<void> {
    try {
        const prefsOf = new Map(context.members.map(member => [member.id, member.prefs]))
        const userIds = Object.entries(context.recipients)
            .filter(([userId, reason]) => wantsPush(prefsOf.get(userId), reason, context.notification.kind, context.agentId))
            .map(([userId]) => userId)
        if (!userIds.length) return
        const now = new Date()
        await Promise.allSettled(userIds.map(userId => pushToUser(supabase, userId, now, context)))
    } catch (err) {
        console.error('[push] failed to dispatch', err)
    }
}

async function pushToUser(supabase: SupabaseClient<Database>, userId: string, now: Date, context: PushContext): Promise<void> {
    const since = pushWindowStart(now).toISOString()
    const [sourceCount, userCount] = await Promise.all([
        selectCount(supabase, 'notification_push_dispatches', { user_id: userId, source_key: context.sourceKey, created_at: { gte: since } }),
        selectCount(supabase, 'notification_push_dispatches', { user_id: userId, created_at: { gte: since } }),
    ])
    if (!pushAllowed({ sourceCount: sourceCount.data ?? 0, userCount: userCount.data ?? 0 })) return

    const { data: devices } = await selectMany(supabase, 'device_tokens', ['token', 'platform'] as const, { user_id: userId, revoked_at: { isNull: true } })
    if (!devices?.length) return

    const { notification } = context
    const locale = await recipientLocale(supabase, userId, context.workspaceId)
    const [t, tErrors] = await Promise.all([translatorFor(locale, 'push'), translatorFor(locale, 'chatErrors')])
    const { title, subtitle, androidTitle, body, silent } = pushCopyOf({ agentName: context.agentName, notification, t, tErrors })
    const data = { workspaceId: context.workspaceId, agentId: context.agentId, conversationId: context.conversationId, kind: notification.kind }
    const iosMessage = { title, subtitle, body, ...(silent ? {} : { sound: 'default' as const }), data }
    const androidMessage = { title: androidTitle, body, ...androidFieldsOf(silent), data }
    const sent = await sendToExpo(
        supabase,
        devices.map(device => ({ ...(device.platform === 'android' ? androidMessage : iosMessage), to: device.token })),
    )
    if (!sent) return

    const { error } = await supabase.from('notification_push_dispatches').insert<DispatchInsert>({ user_id: userId, source_key: context.sourceKey })
    if (error) console.error('[push] failed to record the dispatch', error)
}

// A token Expo reports as dead is revoked rather than retried: the app was uninstalled, and keeping
// it would spend the person's cap on a device that no longer exists.
async function sendToExpo(supabase: SupabaseClient<Database>, messages: ExpoMessage[]): Promise<boolean> {
    const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
    }).catch(err => {
        console.error('[push] Expo request failed', err)
        return null
    })
    if (!response?.ok) {
        console.error('[push] Expo refused the batch', response?.status)
        return false
    }

    const tickets = ((await response.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } }[] } | null)?.data ?? []
    const dead = tickets.flatMap((ticket, index) => (ticket?.details?.error === 'DeviceNotRegistered' && messages[index] ? [messages[index].to] : []))
    if (dead.length) {
        const { error } = await supabase.from('device_tokens').update<DeviceTokenUpdate>({ revoked_at: new Date().toISOString() }).in('token', dead)
        if (error) console.error('[push] failed to revoke dead tokens', error)
    }
    return tickets.some(ticket => ticket?.status === 'ok')
}
