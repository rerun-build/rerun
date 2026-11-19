import { mobileApi, type NotificationPrefs, type NotificationPrefsPatch } from '@rerun/contracts'

import { hub } from '@/api/client'

type Caller = { accessToken: string; workspaceId: number }

export async function fetchNotificationPrefs(caller: Caller): Promise<NotificationPrefs> {
    return hub(mobileApi.getNotificationPrefs, caller)
}

// The hub merges the patch on what it holds and answers with the result.
export async function patchNotificationPrefs(caller: Caller, patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
    return hub(mobileApi.updateNotificationPrefs, { ...caller, body: patch })
}
