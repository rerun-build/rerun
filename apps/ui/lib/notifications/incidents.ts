import type { EmailTranslator } from '@rerun/emails/i18n'
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

// Split from the right because an engine agent id is opaque and could itself hold a colon.
function segmentsOf(key: string): { segment: string; slug: string } {
    const parts = key.split(':')
    return { segment: parts.at(-2) ?? '', slug: parts.at(-1) ?? '' }
}

// Only a scheduled task or a trigger working again is worth an email. A conversation moving on says
// so in the conversation, to someone who is usually the one who moved it on.
export function announcesRecovery(key: string): boolean {
    const { segment } = segmentsOf(key)
    return segment === 'schedule' || segment === 'trigger'
}

// What recovered, named for the email that says so.
export function emailSourceLabel(key: string, t: EmailTranslator): string {
    const { segment, slug } = segmentsOf(key)
    if (segment === 'schedule') return slug === 'run' ? t('incidentResolved.sources.anySchedule') : t('incidentResolved.sources.schedule', { slug })
    if (segment === 'trigger') return slug === 'run' ? t('incidentResolved.sources.anyTrigger') : t('incidentResolved.sources.trigger', { slug })
    return t('incidentResolved.sources.conversation')
}
