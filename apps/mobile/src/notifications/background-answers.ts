import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'

import { answerFromPush } from './answer-from-push'

// Imported by the root layout, so it runs at the top of every launch, the background ones included:
// iOS wakes the app to hand it the button, Android runs the task with the app closed.
const PUSH_ANSWER_TASK = 'rerun-push-answer'

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_ANSWER_TASK, async ({ data }) => {
    if (data && 'actionIdentifier' in data) await answerFromPush(data)
})

if (Platform.OS === 'android') Notifications.registerTaskAsync(PUSH_ANSWER_TASK).catch(error => console.warn('[push] the answer task did not register', error))

Notifications.addNotificationResponseReceivedListener(response => void answerFromPush(response))

// A launch by the button itself hands it over as the last response, before any listener existed.
const launchedBy = Notifications.getLastNotificationResponse()
if (launchedBy) void answerFromPush(launchedBy)
