import type { NotificationKind } from '@/lib/engine/types'

export type SourceKeyInput = {
    event: string
    kind: NotificationKind
    agentId: string
    source?: string | null
    metadata?: Record<string, unknown> | null
    sessionId?: string | null
}

function slugFrom(metadata: Record<string, unknown> | null | undefined, key: string): string {
    const value = metadata?.[key]
    return typeof value === 'string' && value.length > 0 ? value : 'run'
}

// Schedules and triggers are keyed by their own slug so one broken cron never silences the others on
// the same agent. Read from the event and the metadata rather than the top-level `source`, which
// older engines never sent for run completions.
export function sourceKeyFor({ event, kind, agentId, source, metadata }: SourceKeyInput): string {
    if (event === 'agent.schedule.completed') return `${agentId}:schedule:${slugFrom(metadata, 'scheduleSlug')}`
    if (event === 'agent.trigger.completed') return `${agentId}:trigger:${slugFrom(metadata, 'triggerSlug')}`
    if (event === 'agent.notification') return `${agentId}:notify:${kind}`
    return `${agentId}:${source ?? 'interactive'}:run`
}

const sessionKey = (agentId: string, sessionId: string) => `${agentId}:session:${sessionId}`

const isScheduledCompletion = (event: string) => event === 'agent.schedule.completed' || event === 'agent.trigger.completed'

// A scheduled task or a trigger is one incident however many runs keep failing. Anything asked or
// broken inside a conversation belongs to that conversation: one email for it, until it moves on.
export function incidentKeyFor(input: SourceKeyInput): string {
    if (!isScheduledCompletion(input.event) && input.sessionId) return sessionKey(input.agentId, input.sessionId)
    return sourceKeyFor(input)
}

// What a run that went well closes: its scheduled source, and the conversation it ran in.
export function resolvedIncidentKeysFor(input: SourceKeyInput): string[] {
    const keys = isScheduledCompletion(input.event) ? [sourceKeyFor(input)] : []
    if (input.sessionId) keys.push(sessionKey(input.agentId, input.sessionId))
    return keys
}
