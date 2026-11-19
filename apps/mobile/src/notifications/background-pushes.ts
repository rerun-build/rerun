import { pushDataSchema, type PushData } from '@rerun/contracts'
import { getLocales } from 'expo-localization'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'

import { appLocaleOf } from '@/i18n/locale'
import { setCurrentLocale } from '@/i18n/translator'
import { refreshWidgets } from '@/widgets/refresh'

import { answerFromPush } from './answer-from-push'
import { backgroundCaller } from './background-caller'

// Imported by the root layout, so it runs at the top of every launch, the background ones included:
// iOS wakes the app for a push and for a button, Android runs the task with the app closed.
const PUSH_TASK = 'rerun-push'

// Until the screens render, the phone's language: a launch in the background renders none, and a
// widget refreshed there is worded in it. The account's own choice takes over once the app opens.
setCurrentLocale(appLocaleOf(null, getLocales().map(locale => locale.languageTag)))

// A headless push carries its data as a JSON string, a shown one as the notification's content.
function pushDataOfTask(payload: Notifications.NotificationTaskPayload): PushData | null {
    const record = payload as { data?: { dataString?: unknown }; notification?: { request?: { content?: { data?: unknown } } } | null }
    const raw = record.data?.dataString
    try {
        const parsed = pushDataSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : record.notification?.request?.content?.data)
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

async function refreshFromPush(data: PushData | null): Promise<void> {
    const caller = await backgroundCaller(data?.workspaceId)
    if (caller) await refreshWidgets(caller)
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data }) => {
    if (!data) return Notifications.BackgroundNotificationTaskResult.NoData
    if ('actionIdentifier' in data) {
        await answerFromPush(data)
        return Notifications.BackgroundNotificationTaskResult.NoData
    }
    try {
        await refreshFromPush(pushDataOfTask(data))
        return Notifications.BackgroundNotificationTaskResult.NewData
    } catch (error) {
        console.warn('[push] the widgets were not refreshed', error)
        return Notifications.BackgroundNotificationTaskResult.Failed
    }
})

Notifications.registerTaskAsync(PUSH_TASK).catch(error => console.warn('[push] the push task did not register', error))

Notifications.addNotificationResponseReceivedListener(response => void answerFromPush(response))

// A launch by the button itself hands it over as the last response, before any listener existed.
const launchedBy = Notifications.getLastNotificationResponse()
if (launchedBy) void answerFromPush(launchedBy)
