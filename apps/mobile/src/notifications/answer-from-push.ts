import { ANDROID_PUSH_CHANNELS, PUSH_ACTIONS, type ConversationReply, type PushData } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'

import { replyToConversation } from '@/api/chat'
import { translatorFor } from '@/i18n/translator'

import { backgroundCaller } from './background-caller'
import { answersInPlace } from './categories'
import { pushDataOf } from './push'

type InPlaceAction = typeof PUSH_ACTIONS.approve | typeof PUSH_ACTIONS.deny | typeof PUSH_ACTIONS.reply

export function replyOf(action: InPlaceAction, data: PushData, text: string | undefined): ConversationReply | null {
    if (action === PUSH_ACTIONS.reply) {
        const trimmed = text?.trim()
        if (!trimmed) return null
        return data.toolCallId ? { action: 'reply', toolCallId: data.toolCallId, text: trimmed } : { action: 'reply', text: trimmed }
    }
    return data.toolCallId ? { action, toolCallId: data.toolCallId } : null
}

// The same tap can reach the app twice: by the listener, then as the last response read at launch.
const answered = new Set<string>()

// The push is replaced by one saying what happened, which a tap still opens on the conversation. It keeps
// the coworker's portrait, without the state the first one announced.
async function receipt(title: string, body: string, data: PushData): Promise<void> {
    const sender = data.sender && { ...data.sender, state: '' }
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { ...data, toolCallId: undefined, kind: 'receipt', sender }, sound: false }, trigger: { channelId: ANDROID_PUSH_CHANNELS.silent } })
}

export async function answerFromPush(response: Notifications.NotificationResponse): Promise<void> {
    if (!answersInPlace(response)) return
    const { identifier, content } = response.notification.request
    const key = `${identifier}:${response.actionIdentifier}`
    if (answered.has(key)) return
    answered.add(key)
    Notifications.clearLastNotificationResponse()

    const data = pushDataOf(response.notification)
    const action = response.actionIdentifier as InPlaceAction
    const reply = data ? replyOf(action, data, response.userText) : null
    if (!data?.conversationId || !reply) return

    const t = translatorFor('mobileSettings')
    const agent = data.sender?.name ?? content.title ?? t('notifications.receipts.fallbackAgent')
    await Notifications.dismissNotificationAsync(identifier).catch(() => {})
    try {
        const caller = await backgroundCaller(data.workspaceId)
        if (!caller) throw new Error(t('notifications.receipts.signedOut'))
        await replyToConversation(caller, data.conversationId, reply)
        await receipt(agent, t(`notifications.receipts.${action}`, { agent }), data)
    } catch (error) {
        await receipt(agent, t('notifications.receipts.failed', { reason: error instanceof Error ? error.message : '' }), data)
    }
}
