import { friendlyError, type ChatErrorCopy } from '@/lib/chat-error'
import type { NotificationKind } from '@/lib/engine/types'
import type { StoredNotification } from '@/lib/notifications/inbound'

export type PushCopy = { title: string; subtitle: string; body?: string; silent: boolean }

// The `push` namespace, in the language of whoever receives it.
export type PushTranslator = (key: `states.${NotificationKind}` | 'subtitle', values?: Record<string, string>) => string

const BODY_LIMIT = 180

// An engine since `metadata.sourceName` names the routine on its own. An older one writes
// `Schedule "<name>" failed: <error>` and keeps only the slug, so the name is read back from that
// English sentence.
const SCHEDULED_RUN = /^(?:Schedule|Trigger) "(.+?)" (?:failed|completed|stopped)/
const RUN_PREFIX = /^(?:(?:Schedule|Trigger) ".+?" failed|Message failed): /

const isScheduledEvent = (event: StoredNotification['event']) => event === 'agent.schedule.completed' || event === 'agent.trigger.completed'

function sourceNameOf(notification: StoredNotification): string | null {
    if (!isScheduledEvent(notification.event)) return null
    const sourceName = notification.metadata?.sourceName
    if (typeof sourceName === 'string' && sourceName) return sourceName
    const named = SCHEDULED_RUN.exec(notification.message)?.[1]
    if (named) return named
    const slug = notification.metadata?.scheduleSlug ?? notification.metadata?.triggerSlug
    return typeof slug === 'string' && slug ? slug : null
}

function errorOf(notification: StoredNotification): string {
    const error = notification.metadata?.error
    return typeof error === 'string' && error ? error : notification.message.replace(RUN_PREFIX, '')
}

function bodyOf(notification: StoredNotification, tErrors: ChatErrorCopy): string | undefined {
    if (notification.kind === 'error') return friendlyError(errorOf(notification), tErrors)
    // A finished schedule only says "completed", which the subtitle already does.
    if (notification.kind === 'done' && isScheduledEvent(notification.event)) return undefined
    return notification.message
}

function oneLine(text: string | undefined): string | undefined {
    const line = text?.replace(/\s+/g, ' ').trim()
    if (!line) return undefined
    return line.length > BODY_LIMIT ? `${line.slice(0, BODY_LIMIT - 1).trimEnd()}…` : line
}

// Every push reads the same way on a lock screen: who, then where and what, then the detail.
export function pushCopyOf({ agentName, notification, t, tErrors }: { agentName: string; notification: StoredNotification; t: PushTranslator; tErrors: ChatErrorCopy }): PushCopy {
    const sourceName = sourceNameOf(notification)
    const state = t(`states.${notification.kind}`)
    return {
        title: agentName,
        subtitle: sourceName ? t('subtitle', { source: sourceName, state }) : state,
        body: oneLine(bodyOf(notification, tErrors)),
        silent: notification.kind === 'done',
    }
}
