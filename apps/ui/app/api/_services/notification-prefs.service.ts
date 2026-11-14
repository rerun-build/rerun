import 'server-only'

import type { Database } from '@/app/api/database.types'
import { mergeNotificationPrefs, normalizeNotificationPrefs, type NotificationPrefs, type NotificationPrefsPatch } from '@/lib/notifications/prefs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type UserUpdate = Database['public']['Tables']['users']['Update']

export async function readNotificationPrefs(userId: string): Promise<NotificationPrefs> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'users', ['email_notification_prefs'] as const, { id: userId })
    return normalizeNotificationPrefs(data?.email_notification_prefs)
}

export async function patchNotificationPrefs(userId: string, patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
    const merged = mergeNotificationPrefs(await readNotificationPrefs(userId), patch)
    const { error } = await createServiceRoleClient()
        .from('users')
        .update<UserUpdate>({ email_notification_prefs: merged as unknown as UserUpdate['email_notification_prefs'] })
        .eq('id', userId)
    if (error) throw new Error(error.message)
    return merged
}
