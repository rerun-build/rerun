import type { NotificationKind } from '@/lib/engine/types'

import { coworkerRuleOf, isScheduledSource, normalizeNotificationPrefs, taskRuleOf, type NotificationPrefs } from './prefs'

export const NOTIFICATION_REASONS = ['mine', 'participant', 'followed', 'all_activity', 'everything', 'workspace'] as const

export type NotificationReason = (typeof NOTIFICATION_REASONS)[number]

export type NotificationRecipients = Record<string, NotificationReason>

const URGENT_KINDS = new Set<NotificationKind>(['question', 'approval', 'connector', 'error'])

export const isUrgentKind = (kind: NotificationKind) => URGENT_KINDS.has(kind)

const CONCERNED = new Set<NotificationReason>(['mine', 'participant', 'followed', 'workspace'])

export const isConcerned = (reason: NotificationReason) => CONCERNED.has(reason)

export type RoutedEvent = {
    agentId: string | null
    kind: NotificationKind
    source: string | null | undefined
    authorId: string | null
    participantIds: string[]
    taskSlug?: string | null
}

export type RoutedMember = { id: string; prefs: unknown }

export function isUnattended(event: Pick<RoutedEvent, 'source' | 'authorId' | 'participantIds'>): boolean {
    return isScheduledSource(event.source) || (!event.authorId && event.participantIds.length === 0)
}

function relationOf(event: RoutedEvent, memberId: string, prefs: NotificationPrefs): NotificationReason | null {
    if (event.authorId === memberId) return 'mine'
    if (event.participantIds.includes(memberId)) return 'participant'
    if (isUnattended(event) && (taskRuleOf(prefs, event.agentId, event.source, event.taskSlug) ?? coworkerRuleOf(prefs, event.agentId).follow)) return 'followed'
    return null
}

export function reasonFor(event: RoutedEvent, memberId: string, rawPrefs: unknown): NotificationReason | null {
    const prefs = normalizeNotificationPrefs(rawPrefs)
    const rule = coworkerRuleOf(prefs, event.agentId)
    if (rule.mode === 'muted') return null
    if (taskRuleOf(prefs, event.agentId, event.source, event.taskSlug) === false) return null
    const relation = relationOf(event, memberId, prefs)
    if (rule.mode === 'everything') return relation ?? 'all_activity'
    if (prefs.scope === 'everything') return relation ?? 'everything'
    return relation
}

const SCOPED = new Set<NotificationReason>(['mine', 'participant', 'followed'])

function scopeAllows(prefs: NotificationPrefs, reason: NotificationReason, kind: NotificationKind, agentId: string | null | undefined): boolean {
    if (!SCOPED.has(reason) || coworkerRuleOf(prefs, agentId).mode === 'everything') return true
    if (prefs.scope === 'nothing') return false
    if (prefs.scope === 'needed') return isUrgentKind(kind)
    return true
}

export function computeRecipients(event: RoutedEvent, members: RoutedMember[]): NotificationRecipients {
    const recipients: NotificationRecipients = {}
    for (const member of members) {
        const reason = reasonFor(event, member.id, member.prefs)
        if (reason) recipients[member.id] = reason
    }
    return recipients
}

export function needsOwnerFollow(event: RoutedEvent, members: RoutedMember[]): boolean {
    if (!event.agentId || !isScheduledSource(event.source)) return false
    return members.every(member => {
        const prefs = normalizeNotificationPrefs(member.prefs)
        const rule = coworkerRuleOf(prefs, event.agentId)
        return rule.follow === undefined && rule.mode !== 'muted' && taskRuleOf(prefs, event.agentId, event.source, event.taskSlug) === undefined
    })
}

export type Delivery = 'sound' | 'toast' | 'none'

export function deliveryFor(rawPrefs: unknown, reason: NotificationReason, kind: NotificationKind, agentId: string | null | undefined): Delivery {
    const prefs = normalizeNotificationPrefs(rawPrefs)
    if (!scopeAllows(prefs, reason, kind, agentId)) return 'none'
    const concerned = isConcerned(reason)
    const rings = (concerned && isUrgentKind(kind)) || (reason === 'mine' && kind === 'done')
    if (prefs.sound && rings) return 'sound'
    return prefs.toast ? 'toast' : 'none'
}

export function wantsIncidentEmail(rawPrefs: unknown, reason: NotificationReason, kind: NotificationKind, agentId: string | null | undefined): boolean {
    const prefs = normalizeNotificationPrefs(rawPrefs)
    return prefs.email && isConcerned(reason) && isUrgentKind(kind) && scopeAllows(prefs, reason, kind, agentId)
}

export function wantsPush(rawPrefs: unknown, reason: NotificationReason, kind: NotificationKind, agentId: string | null | undefined): boolean {
    return scopeAllows(normalizeNotificationPrefs(rawPrefs), reason, kind, agentId)
}

export function wantsRecoveryEmail(rawPrefs: unknown, agentId: string | null): boolean {
    const prefs = normalizeNotificationPrefs(rawPrefs)
    return prefs.email && prefs.scope !== 'nothing' && coworkerRuleOf(prefs, agentId).mode !== 'muted'
}

export function recipientReason(recipients: unknown, userId: string | null | undefined): NotificationReason | 'legacy' | null {
    if (recipients === null || recipients === undefined) return 'legacy'
    if (!userId || typeof recipients !== 'object') return null
    const reason = (recipients as Record<string, unknown>)[userId]
    return NOTIFICATION_REASONS.includes(reason as NotificationReason) ? (reason as NotificationReason) : null
}
