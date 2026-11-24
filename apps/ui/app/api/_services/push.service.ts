import type { Database } from '@/app/api/database.types'
import type { StoredNotification } from '@/lib/notifications/inbound'
import { recipientLocale } from '@/lib/i18n/recipient-locale'
import { translatorFor } from '@/lib/i18n/server-translator'
import { coworkerPortraitUrl } from '@/lib/og/coworker-portrait'
import { warmImage } from '@/lib/og/warm'
import { pushCopyOf } from '@/lib/notifications/push-copy'
import { pushButtonsOf } from '@/lib/notifications/push-buttons'
import { pushAllowed, pushWindowStart } from '@/lib/notifications/push-limits'
import { wantsPush, type NotificationRecipients, type RoutedMember } from '@/lib/notifications/routing'
import { selectCount, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { ANDROID_PUSH_CHANNELS, FOREMAN_AGENT_ID, parseCoworkerLook, type AndroidPushChannel, type PushCategory, type PushData, type PushSender } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

type DispatchInsert = Database['public']['Tables']['notification_push_dispatches']['Insert']
type DeviceTokenUpdate = Database['public']['Tables']['device_tokens']['Update']

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const PORTRAIT_WARM_MS = 20_000

// Expo holds the APNs and FCM credentials, so the hub sends a plain POST rather than keeping an HTTP/2
// connection open to Apple, which a route handler is in no position to do.
type ExpoMessage = { to: string; title: string; subtitle?: string; body?: string; sound?: 'default'; channelId?: AndroidPushChannel; priority?: 'high'; categoryId?: PushCategory; _contentAvailable?: true; mutableContent?: true; data: PushData }

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
        const portrait = await portraitOf(supabase, context.agentId)
        // Not waited for: the push leaves at once, and the phone asking for the picture joins the capture.
        if (portrait) void warmImage(portrait, PORTRAIT_WARM_MS)
        await Promise.allSettled(userIds.map(userId => pushToUser(supabase, userId, now, context, portrait)))
    } catch (err) {
        console.error('[push] failed to dispatch', err)
    }
}

// The Chief of Staff wears no look: it is drawn as its orb. A look that cannot be read costs
// the push its own portrait, never the push.
async function portraitOf(supabase: SupabaseClient<Database>, agentId: string | null): Promise<string | null> {
    if (!agentId) return null
    if (agentId === FOREMAN_AGENT_ID) return coworkerPortraitUrl(agentId, null)
    const { data: agent, error } = await selectMaybeSingle(supabase, 'agents', ['look'] as const, { id: agentId })
    if (error) console.error('[push] failed to read the look of a coworker', error)
    return agent ? coworkerPortraitUrl(agentId, parseCoworkerLook(agent.look)) : null
}

async function pushToUser(supabase: SupabaseClient<Database>, userId: string, now: Date, context: PushContext, portrait: string | null): Promise<void> {
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
    const buttons = pushButtonsOf(notification, context.conversationId)
    const sender: PushSender | null = portrait ? { name: context.agentName, image: portrait, state: subtitle } : null
    const data: PushData = { workspaceId: context.workspaceId, agentId: context.agentId, conversationId: context.conversationId, kind: notification.kind, ...(buttons?.toolCallId ? { toolCallId: buttons.toolCallId } : {}), ...(sender ? { sender } : {}) }
    const category = buttons ? { categoryId: buttons.categoryId } : {}
    // iOS wakes the app a moment for each push, which reads the crew again for its widgets. A mutable
    // push goes through the app's notification service first, which puts the portrait on it.
    const iosMessage = { title, subtitle, body, ...(silent ? {} : { sound: 'default' as const }), ...category, _contentAvailable: true as const, ...(sender ? { mutableContent: true as const } : {}), data }
    const androidMessage = { title: androidTitle, body, ...androidFieldsOf(silent), ...category, data }
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
