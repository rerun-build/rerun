import { pendingMcpSignIn, pendingServices } from '@rerun/contracts'

import type { Json } from '@/app/api/database.types'
import type { ChatErrorCopy } from '@/lib/chat-error'
import type { AlertState } from '@/lib/og/alert-board'

import { errorHeadline } from './attention-details'
import type { StoredNotification } from './inbound'
import type { IncidentKind } from './routing'

// Three a day for one person, whatever the number of coworkers: past that, the app holds the rest.
export const DAILY_EMAIL_CAP = 3
export const DAILY_EMAIL_WINDOW_MS = 24 * 60 * 60_000

// A proposed skill waits for a yes without holding the run that proposed it.
export function holdsARun({ metadata }: Pick<StoredNotification, 'metadata'>): boolean {
    return metadata?.toolName !== 'skill_propose'
}

export const ALERT_STATE_OF_KIND: Record<IncidentKind, AlertState> = { question: 'question', approval: 'approval', connector: 'connector', error: 'failed' }

// Taking over a browser is neither approved nor denied: the email only opens the conversation.
export function opensConversation({ metadata }: Pick<StoredNotification, 'metadata'>): boolean {
    return metadata?.toolName === 'request_takeover'
}

export type AwaitedApp = { slug?: string; name?: string; reason?: string }

// The app a `connector` waits for, from the tool call that asked for it: a catalog slug, or the name of
// a server the catalog does not know. Several at once, or a bare key, name no single app.
export function awaitedApp({ metadata }: Pick<StoredNotification, 'metadata'>): AwaitedApp {
    const input = metadata?.input
    if (typeof input !== 'object' || input === null) return {}
    if (metadata?.toolName === 'suggest_service') {
        const services = pendingServices(input as Record<string, unknown>)
        return services.length === 1 ? { slug: services[0].slug, reason: services[0].reason?.trim() || undefined } : {}
    }
    if (metadata?.toolName === 'request_mcp_sign_in') {
        const { name, reason } = pendingMcpSignIn(input as Record<string, unknown>)
        return { name: name.trim() || undefined, reason }
    }
    return {}
}

// What the bubble says: the reason the coworker gave for the app it waits for, the inbox's line for a
// run that broke, its own words otherwise.
export function incidentMessage(notification: StoredNotification, tErrors: ChatErrorCopy): string {
    if (notification.kind === 'error') return errorHeadline({ message: notification.message, metadata: (notification.metadata ?? null) as Json | null }, tErrors)
    return (notification.kind === 'connector' && awaitedApp(notification).reason) || notification.message
}
