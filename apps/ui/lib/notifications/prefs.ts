import { normalizeNotificationPrefs, type EmailCategory } from '@rerun/contracts'
import type { NotificationKind } from '@/lib/engine/types'

export {
    COWORKER_MODES,
    DEFAULT_COWORKER_RULE,
    DEFAULT_NOTIFICATION_PREFS,
    EMAIL_CATEGORIES,
    NOTIFICATION_SCOPES,
    coworkerRuleOf,
    hasOwnRule,
    isScheduledSource,
    mergeNotificationPrefs,
    normalizeNotificationPrefs,
    notificationPrefsPatchSchema,
    resetRule,
    taskKey,
    taskNotifies,
    taskRuleOf,
    type CoworkerMode,
    type CoworkerRule,
    type EmailCategory,
    type NotificationPrefs,
    type NotificationPrefsPatch,
    type NotificationScope,
} from '@rerun/contracts'

// Paused on 21/10/2026: no incident, recovery or budget email leaves. The in-app rows are still written.
export const NOTIFICATION_EMAILS_PAUSED = true

// The notification kinds the engine can send, in display order. The `notification_kind` enum in the
// database is a superset: Postgres cannot drop an enum value, so retired kinds stay parked there.
export const NOTIFICATION_KINDS = ['done', 'error', 'info', 'question', 'approval', 'connector'] as const

export function wantsCategoryEmail(prefs: unknown, category: EmailCategory): boolean {
    return normalizeNotificationPrefs(prefs).categories[category]
}

// Still the labels of the admin's test email picker.
export const EMAIL_KIND_LABELS: Record<NotificationKind, string> = {
    done: 'Run finished',
    error: 'Errors',
    info: 'Needs your attention',
    question: 'Coworker has a question',
    approval: 'Approval needed',
    connector: 'App setup',
}

// What the unsubscribe page edits: the run email switch and the account categories.
export type EmailPrefs = { email: boolean; categories: Record<EmailCategory, boolean> }

export function normalizeEmailPrefs(value: unknown): EmailPrefs {
    const prefs = normalizeNotificationPrefs(value)
    return { email: prefs.email, categories: prefs.categories }
}
