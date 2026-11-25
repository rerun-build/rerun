import { normalizeNotificationPrefs, type EmailCategory } from '@rerun/contracts'

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

export function wantsCategoryEmail(prefs: unknown, category: EmailCategory): boolean {
    return normalizeNotificationPrefs(prefs).categories[category]
}

// What the unsubscribe page edits: the run email switch and the account categories.
export type EmailPrefs = { email: boolean; categories: Record<EmailCategory, boolean> }

export function normalizeEmailPrefs(value: unknown): EmailPrefs {
    const prefs = normalizeNotificationPrefs(value)
    return { email: prefs.email, categories: prefs.categories }
}
