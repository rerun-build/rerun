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

export function sourceKeyFor({ event, kind, agentId, source, metadata }: SourceKeyInput): string {
    if (event === 'agent.schedule.completed') return `${agentId}:schedule:${slugFrom(metadata, 'scheduleSlug')}`
    if (event === 'agent.trigger.completed') return `${agentId}:trigger:${slugFrom(metadata, 'triggerSlug')}`
    if (event === 'agent.notification') return `${agentId}:notify:${kind}`
    return `${agentId}:${source ?? 'interactive'}:run`
}

const sessionKey = (agentId: string, sessionId: string) => `${agentId}:session:${sessionId}`

const isScheduledCompletion = (event: string) => event === 'agent.schedule.completed' || event === 'agent.trigger.completed'

export function incidentKeyFor(input: SourceKeyInput): string {
    if (!isScheduledCompletion(input.event) && input.sessionId) return sessionKey(input.agentId, input.sessionId)
    return sourceKeyFor(input)
}

export function resolvedIncidentKeysFor(input: SourceKeyInput): string[] {
    const keys = isScheduledCompletion(input.event) ? [sourceKeyFor(input)] : []
    if (input.sessionId) keys.push(sessionKey(input.agentId, input.sessionId))
    return keys
}

function segmentsOf(key: string): { segment: string; slug: string } {
    const parts = key.split(':')
    return { segment: parts.at(-2) ?? '', slug: parts.at(-1) ?? '' }
}

export function announcesRecovery(key: string): boolean {
    const { segment } = segmentsOf(key)
    return segment === 'schedule' || segment === 'trigger'
}

export function emailSourceLabel(key: string, t: EmailTranslator): string {
    const { segment, slug } = segmentsOf(key)
    if (segment === 'schedule') return slug === 'run' ? t('incidentResolved.sources.anySchedule') : t('incidentResolved.sources.schedule', { slug })
    if (segment === 'trigger') return slug === 'run' ? t('incidentResolved.sources.anyTrigger') : t('incidentResolved.sources.trigger', { slug })
    return t('incidentResolved.sources.conversation')
}
