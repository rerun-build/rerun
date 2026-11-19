import { normalizeNotificationPrefs, type EmailCategory } from '@moldwright/contracts'
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
} from '@moldwright/contracts'

export const NOTIFICATION_EMAILS_PAUSED = true

export const NOTIFICATION_KINDS = ['done', 'error', 'info', 'question', 'approval', 'connector'] as const

export function wantsCategoryEmail(prefs: unknown, category: EmailCategory): boolean {
    return normalizeNotificationPrefs(prefs).categories[category]
}

export const EMAIL_KIND_LABELS: Record<NotificationKind, string> = {
    done: 'Run finished',
    error: 'Errors',
    info: 'Needs your attention',
    question: 'Coworker has a question',
    approval: 'Approval needed',
    connector: 'App setup',
}

export type EmailPrefs = { email: boolean; categories: Record<EmailCategory, boolean> }

export function normalizeEmailPrefs(value: unknown): EmailPrefs {
    const prefs = normalizeNotificationPrefs(value)
    return { email: prefs.email, categories: prefs.categories }
}
