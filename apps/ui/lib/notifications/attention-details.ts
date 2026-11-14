import type { Json } from '@/app/api/database.types'
import { chatErrorTitle, classifyChatError, stripErrorPrefix, type ChatErrorCopy } from '@/lib/chat-error'
import { recipientReason, type NotificationReason } from '@/lib/notifications/routing'

export type AttentionDetail = { engineSessionId: string | null; title: string; message: string | null; updatedAt: string | null; reason: NotificationReason | 'legacy' | null }

export type AttentionSessionRow = { id: string; agent_id: string; engine_session_id: string | null; title: string; updated_at: string }

export type AttentionNotificationRow = { agent_id: string | null; engine_session_id: string | null; kind: string; message: string; metadata: Json | null; recipients: Json | null }

export const ATTENTION_NOTIFICATION_COLUMNS = ['agent_id', 'engine_session_id', 'kind', 'message', 'metadata', 'recipients'] as const

export function attentionNotificationsFilter(sessions: AttentionSessionRow[]) {
    const engineSessionIds = sessions.flatMap(s => (s.engine_session_id ? [s.engine_session_id] : []))
    const agentIds = [...new Set(sessions.map(s => s.agent_id))]
    return engineSessionIds.length ? { agent_id: { in: agentIds }, engine_session_id: { in: engineSessionIds }, kind: { neq: 'done' as const } } : null
}

export function attentionDetailsOf(sessions: AttentionSessionRow[], notifications: AttentionNotificationRow[], userId: string | null | undefined, tErrors: ChatErrorCopy): Record<string, AttentionDetail> {
    const latest = new Map<string, { message: string; reason: NotificationReason | 'legacy' | null }>()
    for (const n of notifications) {
        const key = `${n.agent_id}:${n.engine_session_id}`
        if (!latest.has(key)) latest.set(key, { message: n.kind === 'error' ? errorHeadline(n, tErrors) : n.message, reason: recipientReason(n.recipients, userId) })
    }

    return Object.fromEntries(
        sessions.map(s => {
            const found = latest.get(`${s.agent_id}:${s.engine_session_id}`)
            return [s.id, { engineSessionId: s.engine_session_id, title: s.title, message: found?.message.trim() || null, updatedAt: s.updated_at, reason: found ? found.reason : 'legacy' }]
        })
    )
}

export function errorHeadline(notification: { message: string; metadata: Json | null }, tErrors: ChatErrorCopy): string {
    const metadata = notification.metadata as { error?: unknown } | null
    const error = typeof metadata?.error === 'string' ? metadata.error : notification.message
    return chatErrorTitle(classifyChatError(error), error, tErrors) ?? stripErrorPrefix(error)
}
