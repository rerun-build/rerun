import type { Database } from '@/app/api/database.types'
import { RETIRED_NOTIFICATION_KIND, type NotificationKind, type NotificationPayload } from '@/lib/engine/types'

type SessionStatus = Database['public']['Enums']['session_status']

export type StoredNotification = Omit<NotificationPayload, 'kind'> & { kind: NotificationKind }

const ENGINE_DERIVED_KINDS = new Set<NotificationKind>(['question', 'approval', 'connector'])

export function storedKind(payload: NotificationPayload): NotificationKind | null {
    if (payload.kind === RETIRED_NOTIFICATION_KIND) return null
    if (payload.event !== 'agent.notification') return payload.kind
    return ENGINE_DERIVED_KINDS.has(payload.kind) ? payload.kind : 'info'
}

export function isRunCompletion(event: NotificationPayload['event']): boolean {
    return event.endsWith('.completed')
}

export function completionStatus(notification: StoredNotification): SessionStatus | null {
    if (notification.event === 'agent.notification') {
        if (notification.kind === 'question') return 'awaiting_question' as unknown as SessionStatus
        if (notification.kind === 'approval') return 'awaiting_approval' as unknown as SessionStatus
        if (notification.kind === 'connector') return 'awaiting_connector' as unknown as SessionStatus
        return 'awaiting_ack' as unknown as SessionStatus
    }
    if (!isRunCompletion(notification.event)) return null
    if (notification.kind === 'done') return 'idle'
    if (notification.kind === 'error') return 'error'
    return null
}

type SessionOutcome = Database['public']['Enums']['session_outcome']

export function automatedRunReport(notification: StoredNotification): { failed: boolean; report: string | null } | null {
    if (notification.event !== 'agent.schedule.completed' && notification.event !== 'agent.trigger.completed') return null
    if (notification.kind !== 'done' && notification.kind !== 'error') return null
    const failed = notification.kind === 'error'
    const value = notification.metadata?.[failed ? 'error' : 'finalText']
    const report = typeof value === 'string' && value.trim() ? value.trim() : null
    return { failed, report }
}

export function automatedRunOutcome(failed: boolean, nothingToReport: boolean): SessionOutcome {
    if (failed) return 'failed'
    return nothingToReport ? 'nothing' : 'done'
}
