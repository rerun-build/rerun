import { notificationPrefsSchema, type NotificationPrefs, type NotificationPrefsPatch } from '@moldwright/contracts'

import { api } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchNotificationPrefs(caller: Caller): Promise<NotificationPrefs> {
    return notificationPrefsSchema.parse(await api('/api/v1/me/notifications', caller))
}

export async function patchNotificationPrefs(caller: Caller, patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
    return notificationPrefsSchema.parse(await api('/api/v1/me/notifications', { ...caller, method: 'PATCH', body: patch }))
}
