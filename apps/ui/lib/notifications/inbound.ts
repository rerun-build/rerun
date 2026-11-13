import type { Database } from '@/app/api/database.types'
import { RETIRED_NOTIFICATION_KIND, type NotificationKind, type NotificationPayload } from '@/lib/engine/types'

type SessionStatus = Database['public']['Enums']['session_status']

// A payload once its kind has been settled, which is what the rest of the pipeline stores, mirrors
// onto the session and fans out by email.
export type StoredNotification = Omit<NotificationPayload, 'kind'> & { kind: NotificationKind }

// The only kinds an `agent.notification` can legitimately carry are the ones the engine derives from
// the HITL tool the run stopped on. Anything else is the model picking a label inside `notify_user`,
// and it always means the same thing: look at this. Older engines let it pick `done`, which then died
// against the run-completion preference users turn off to silence end-of-turn noise.
const ENGINE_DERIVED_KINDS = new Set<NotificationKind>(['question', 'approval', 'connector'])

// `null` drops the notification: `progress` no longer exists as a kind, and an engine that has not
// taken the update yet must not resurrect it.
export function storedKind(payload: NotificationPayload): NotificationKind | null {
    if (payload.kind === RETIRED_NOTIFICATION_KIND) return null
    if (payload.event !== 'agent.notification') return payload.kind
    return ENGINE_DERIVED_KINDS.has(payload.kind) ? payload.kind : 'info'
}

// Every run-completion event the engine emits ends in `.completed`, whatever started the run
// (message, schedule, trigger). Matching on the suffix rather than an explicit list means a new
// trigger source never silently leaves its sessions stuck on 'working'.
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

// What an automated run's end hands the title generator: its final answer, or the error that ended
// it. `null` for a chat run, a stopped one, or an engine older than `finalText` that sent nothing.
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

// What an engine with nothing to say writes as the message of a finished chat run: never a reply.
const EMPTY_REPLY = 'Message completed'

// The start of what the coworker answered, for the list of coworkers: a chat run's message, a
// routine's final text. A run that failed or was stopped says nothing new, and leaves the last line.
export function agentReplyOf(notification: StoredNotification): string | null {
    if (notification.kind !== 'done' || notification.metadata?.status === 'cancelled') return null
    if (notification.event === 'agent.message.completed') {
        const message = notification.message?.trim()
        return message && message !== EMPTY_REPLY ? message : null
    }
    if (notification.event === 'agent.schedule.completed' || notification.event === 'agent.trigger.completed') {
        const finalText = notification.metadata?.finalText
        return typeof finalText === 'string' && finalText.trim() ? finalText.trim() : null
    }
    return null
}
