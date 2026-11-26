import type { NotificationKind } from '@/lib/engine/types'

/** The session status a notification leaves behind, which is what puts a row in the hub. A `done` leaves none: it is announced to whoever it reached, then gone. */
export const ANNOUNCED_STATUS: Partial<Record<NotificationKind, string>> = {
    question: 'awaiting_question',
    approval: 'awaiting_approval',
    connector: 'awaiting_connector',
    info: 'awaiting_ack',
    error: 'error',
}

export type AnnouncedNotification = {
    id: string
    agentId: string | null
    status: string
    /** One line, as the hub row words it. */
    headline: string
    /** The full markdown message. */
    message: string
    engineSessionId: string | null
    engineRunId: string | null
    /** The routine a script's run belongs to: it has no conversation, so the notification opens it. */
    scriptSlug?: string | null
    createdAt: string
}

export const FINISHED_STATUS = 'done'

export const isLoud = (status: string) => status !== 'awaiting_ack' && status !== FINISHED_STATUS

export const LOUD_DWELL_MS = 4500
export const SOFT_DWELL_MS = 3000
const BUNDLE_FROM = 2

export type AnnouncerState = { cursor: number; bundled: number }

/**
 * Moves past the arrival on show. Two or more waiting behind it are announced as one bundle
 * rather than played one after the other.
 */
export function advance(state: AnnouncerState, total: number): AnnouncerState {
    if (state.cursor >= total) return state
    const next = state.cursor + 1
    const waiting = total - next
    return waiting >= BUNDLE_FROM ? { cursor: total - 1, bundled: waiting } : { cursor: next, bundled: 1 }
}
