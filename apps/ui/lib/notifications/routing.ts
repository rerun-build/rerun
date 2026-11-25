import type { NotificationKind } from '@/lib/engine/types'

import { coworkerRuleOf, isScheduledSource, normalizeNotificationPrefs, taskRuleOf, type NotificationPrefs } from './prefs'

// Why a notification reaches someone, stored per recipient in `notifications.recipients` and shown
// under the inbox row. `workspace` is news for every member, like a budget running out.
export const NOTIFICATION_REASONS = ['mine', 'participant', 'followed', 'all_activity', 'everything', 'workspace'] as const

export type NotificationReason = (typeof NOTIFICATION_REASONS)[number]

export type NotificationRecipients = Record<string, NotificationReason>

// What waits for someone, or broke: the only kinds worth an email.
export const INCIDENT_KINDS = ['question', 'approval', 'connector', 'error'] as const satisfies readonly NotificationKind[]

export type IncidentKind = (typeof INCIDENT_KINDS)[number]

export const isUrgentKind = (kind: NotificationKind): kind is IncidentKind => (INCIDENT_KINDS as readonly NotificationKind[]).includes(kind)

// The reasons that make it your run rather than news about someone else's.
const CONCERNED = new Set<NotificationReason>(['mine', 'participant', 'followed', 'workspace'])

export const isConcerned = (reason: NotificationReason) => CONCERNED.has(reason)

export type RoutedEvent = {
    agentId: string | null
    kind: NotificationKind
    source: string | null | undefined
    /** The member who sent the message that started the run, when one did. */
    authorId: string | null
    /** Everyone who wrote in the conversation. */
    participantIds: string[]
    /** The scheduled task or trigger that started the run. */
    taskSlug?: string | null
}

export type RoutedMember = { id: string; prefs: unknown }

// Nobody is watching a run that nobody started from a message: a cron, a webhook, one coworker
// calling another. It reaches whoever follows the coworker.
export function isUnattended(event: Pick<RoutedEvent, 'source' | 'authorId' | 'participantIds'>): boolean {
    return isScheduledSource(event.source) || (!event.authorId && event.participantIds.length === 0)
}

function relationOf(event: RoutedEvent, memberId: string, prefs: NotificationPrefs): NotificationReason | null {
    if (event.authorId === memberId) return 'mine'
    if (event.participantIds.includes(memberId)) return 'participant'
    if (isUnattended(event) && (taskRuleOf(prefs, event.agentId, event.source, event.taskSlug) ?? coworkerRuleOf(prefs, event.agentId).follow)) return 'followed'
    return null
}

// Who the notification is about, stored with the row. The scope is not applied here: it says how
// loud, not whether the row is theirs, so « Nothing » still leaves the row in their inbox.
export function reasonFor(event: RoutedEvent, memberId: string, rawPrefs: unknown): NotificationReason | null {
    const prefs = normalizeNotificationPrefs(rawPrefs)
    const rule = coworkerRuleOf(prefs, event.agentId)
    if (rule.mode === 'muted') return null
    // « Notify me » off on a task is off, whatever the coworker or the scope say.
    if (taskRuleOf(prefs, event.agentId, event.source, event.taskSlug) === false) return null
    const relation = relationOf(event, memberId, prefs)
    if (rule.mode === 'everything') return relation ?? 'all_activity'
    if (prefs.scope === 'everything') return relation ?? 'everything'
    return relation
}

// The reasons the scope narrows. Workspace news, and anything from a coworker set to « All
// activity », go through whatever the scope says.
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

// A scheduled task on a coworker nobody ever decided to follow or not goes to the owner, so a cron
// written before authors were recorded still reaches someone. Once anyone has a say, a follow, a
// stop or a mute, it never applies. A chat whose participant is not recorded yet looks unattended
// too, which is why the source decides.
export function needsOwnerFollow(event: RoutedEvent, members: RoutedMember[]): boolean {
    if (!event.agentId || !isScheduledSource(event.source)) return false
    return members.every(member => {
        const prefs = normalizeNotificationPrefs(member.prefs)
        const rule = coworkerRuleOf(prefs, event.agentId)
        return rule.follow === undefined && rule.mode !== 'muted' && taskRuleOf(prefs, event.agentId, event.source, event.taskSlug) === undefined
    })
}

export type Delivery = 'sound' | 'toast' | 'none'

// What an open tab does with a notification that reached its user. The sound is kept for what
// needs you or broke in your own runs, plus your own run finishing; anything else is a quiet toast.
export function deliveryFor(rawPrefs: unknown, reason: NotificationReason, kind: NotificationKind, agentId: string | null | undefined): Delivery {
    const prefs = normalizeNotificationPrefs(rawPrefs)
    if (!scopeAllows(prefs, reason, kind, agentId)) return 'none'
    const concerned = isConcerned(reason)
    const rings = (concerned && isUrgentKind(kind)) || (reason === 'mine' && kind === 'done')
    if (prefs.sound && rings) return 'sound'
    return prefs.toast ? 'toast' : 'none'
}

// Email is for someone away, about something that needs them or broke in what they are concerned by.
export function wantsIncidentEmail(rawPrefs: unknown, reason: NotificationReason, kind: NotificationKind, agentId: string | null | undefined): boolean {
    const prefs = normalizeNotificationPrefs(rawPrefs)
    return prefs.email && isConcerned(reason) && isUrgentKind(kind) && scopeAllows(prefs, reason, kind, agentId)
}

// A phone rings for what the scope lets through, whether or not a tab is open somewhere: reaching
// someone away from a computer is the point of a push.
export function wantsPush(rawPrefs: unknown, reason: NotificationReason, kind: NotificationKind, agentId: string | null | undefined): boolean {
    return scopeAllows(normalizeNotificationPrefs(rawPrefs), reason, kind, agentId)
}

// A row stored before recipients existed (null) reaches everyone, as it did then.
export function recipientReason(recipients: unknown, userId: string | null | undefined): NotificationReason | 'legacy' | null {
    if (recipients === null || recipients === undefined) return 'legacy'
    if (!userId || typeof recipients !== 'object') return null
    const reason = (recipients as Record<string, unknown>)[userId]
    return NOTIFICATION_REASONS.includes(reason as NotificationReason) ? (reason as NotificationReason) : null
}
