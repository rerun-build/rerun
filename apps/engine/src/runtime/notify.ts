import type { MessageAuthor } from '@rerun/contracts'
import { env } from '../config/env.js'
import { nowIso } from '../lib/ids.js'
import { logger } from '../lib/logger.js'

export type NotificationKind = 'info' | 'question' | 'approval' | 'connector' | 'done' | 'error'

// `agent.schedule.created`, `agent.trigger.created` and `box.connection.connected` carry no message
// for anyone: they tell the hub an automation now exists, or a step of the workspace's
// getting-started checklist just happened on the box. `box.vault.signed_out` tells it a Vault item's
// token can no longer be refreshed, so the Vault shows the item to reconnect.
export type NotificationEvent =
    | 'agent.notification'
    | 'agent.message.completed'
    | 'agent.schedule.completed'
    | 'agent.trigger.completed'
    | 'agent.session.created'
    | 'agent.schedule.created'
    | 'agent.trigger.created'
    | 'box.connection.connected'
    | 'box.vault.signed_out'

export type NotificationPayload = {
    event: NotificationEvent
    kind: NotificationKind
    // `null` for a box-wide event, which belongs to no agent.
    agentId: string | null
    sessionId: string | null
    runId: string | null
    message: string
    metadata: Record<string, unknown> | null
    title: string | null
    source: string | null
    originAgentId: string | null
    timestamp: string
}

export type NotificationInput = {
    event?: NotificationEvent
    kind: NotificationKind
    agentId: string | null
    sessionId?: string | null
    runId?: string | null
    message: string
    metadata?: Record<string, unknown> | null
    title?: string | null
    source?: string | null
    originAgentId?: string | null
}

// The member whose chat message started the run, so the hub can route the event to them.
export function authorMetadata(author: MessageAuthor | undefined): { authorId?: string } {
    return author ? { authorId: author.id } : {}
}

const TIMEOUT_MS = 5000

export async function sendNotification(input: NotificationInput): Promise<{ delivered: boolean; reason?: string }> {
    const { RERUN_HUB_BASE_URL: hub, RERUN_API_KEY: token } = env()
    if (!hub || !token) {
        logger.debug({ agent: input.agentId }, 'notification skipped: webhook not configured')
        return { delivered: false, reason: 'webhook not configured' }
    }
    const url = `${hub.replace(/\/$/, '')}/api/webhooks/engine`

    const payload: NotificationPayload = {
        event: input.event ?? 'agent.notification',
        kind: input.kind,
        agentId: input.agentId,
        sessionId: input.sessionId ?? null,
        runId: input.runId ?? null,
        message: input.message,
        metadata: input.metadata ?? null,
        title: input.title ?? null,
        source: input.source ?? null,
        originAgentId: input.originAgentId ?? null,
        timestamp: nowIso(),
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
            signal: controller.signal,
        })
        if (!res.ok) {
            logger.warn({ agent: input.agentId, status: res.status }, 'notification delivery failed')
            return { delivered: false, reason: `status ${res.status}` }
        }
        return { delivered: true }
    } catch (err) {
        logger.warn({ agent: input.agentId, err: String(err) }, 'notification delivery error')
        return { delivered: false, reason: err instanceof Error ? err.message : String(err) }
    } finally {
        clearTimeout(timer)
    }
}
