'use server'

import { patchNotificationPrefs } from '@/app/api/_services/notification-prefs.service'
import { verifyUnsubscribeToken } from '@moldwright/cloud/email'
import { notificationPrefsPatchSchema, type NotificationPrefsPatch } from '@/lib/notifications/prefs'
import { getServerSession } from '@/supabase/session/getServerSession'
import { failure, failureOf, type ActionFailure } from '@/lib/i18n/action-error'

export type UpdatePrefsResult = { ok: true } | ActionFailure

export async function updateNotificationPrefsAction(patch: NotificationPrefsPatch): Promise<UpdatePrefsResult> {
    try {
        const parsed = notificationPrefsPatchSchema.safeParse(patch)
        if (!parsed.success) return failure('invalidPreferences')

        const { user } = await getServerSession()
        if (!user?.id) return failure('notAuthenticated')

        await patchNotificationPrefs(user.id, parsed.data)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'updatePreferencesFailed')
    }
}

export async function updateNotificationPrefsByTokenAction(token: string, patch: NotificationPrefsPatch): Promise<UpdatePrefsResult> {
    try {
        const parsed = notificationPrefsPatchSchema.safeParse(patch)
        if (!parsed.success) return failure('invalidPreferences')

        const target = verifyUnsubscribeToken(token)
        if (!target) return failure('linkInvalidOrExpired')

        await patchNotificationPrefs(target.userId, parsed.data)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'updatePreferencesFailed')
    }
}
