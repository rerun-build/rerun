import { PUSH_ACTIONS, PUSH_CATEGORIES } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { translatorFor } from '@/i18n/translator'

// No answer leaves a locked phone: a lock screen is in anyone's hands, and an approval or a line sent
// to a coworker acts in the person's name. iOS asks for Face ID and answers without opening the app.
// Android has no such guard on a button, so there it opens the app, which the system only does once
// the phone is unlocked, and the answer leaves from the open app.
const IN_PLACE = { opensAppToForeground: Platform.OS === 'android', isAuthenticationRequired: true, isDestructive: false }
const OPENS_APP = { opensAppToForeground: true, isAuthenticationRequired: false, isDestructive: false }

const IN_PLACE_ACTIONS: ReadonlySet<string> = new Set([PUSH_ACTIONS.approve, PUSH_ACTIONS.deny, PUSH_ACTIONS.reply])

// A button that answers without opening a conversation. A tap on the push itself, or on Open, is
// the routing's to handle.
export function answersInPlace(response: Notifications.NotificationResponse): boolean {
    return IN_PLACE_ACTIONS.has(response.actionIdentifier)
}

// Set again on every launch, like the Android channels: it words the buttons in the current language.
export async function registerPushCategories(): Promise<void> {
    const t = translatorFor('mobileSettings')
    const open: Notifications.NotificationAction = { identifier: PUSH_ACTIONS.open, buttonTitle: t('notifications.actions.open'), options: OPENS_APP }
    const reply = (buttonTitle: string): Notifications.NotificationAction => ({
        identifier: PUSH_ACTIONS.reply,
        buttonTitle,
        options: IN_PLACE,
        textInput: { placeholder: t('notifications.actions.replyPlaceholder'), submitButtonTitle: t('notifications.actions.send') },
    })
    await Promise.all([
        Notifications.setNotificationCategoryAsync(PUSH_CATEGORIES.approval, [
            { identifier: PUSH_ACTIONS.approve, buttonTitle: t('notifications.actions.approve'), options: IN_PLACE },
            { identifier: PUSH_ACTIONS.deny, buttonTitle: t('notifications.actions.deny'), options: { ...IN_PLACE, isDestructive: true } },
            open,
        ]),
        Notifications.setNotificationCategoryAsync(PUSH_CATEGORIES.question, [reply(t('notifications.actions.answer')), open]),
        Notifications.setNotificationCategoryAsync(PUSH_CATEGORIES.reply, [reply(t('notifications.actions.reply'))]),
    ])
}
