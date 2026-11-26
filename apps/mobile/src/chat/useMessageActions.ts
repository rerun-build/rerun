import { counterpartIn, editableTextOf, engineMessageIdOf, messageEditRefusalOf, messageLinkOf, messageText, replyBounds, userIndexBefore } from '@rerun/contracts'
import { generateId, type UIMessage } from 'ai'
import * as Clipboard from 'expo-clipboard'
import { useTranslations } from 'use-intl'
import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'

import { deleteConversationMessage } from '@/api/chat'
import type { ChatEndpoints } from '@/chat/endpoints'
import { showActionSheet } from '@/components/ui/system-dialogs'
import { environment } from '@/config/environment'
import * as Haptics from '@/lib/haptics'
import { useStableCallback } from '@/lib/use-stable-callback'

type Caller = { accessToken: string; workspaceId: number }

type ChatLike = {
    messages: UIMessage[]
    setMessages: (messages: UIMessage[]) => void
    sessionId: string | null
    busy: boolean
    send: (text: string, files?: undefined, options?: { replaceFrom?: string }) => unknown
    regenerate: (options?: { replaceFrom?: string }) => unknown
    error: Error | undefined
    clearError: () => void
    // Reads the transcript the hub keeps again.
    retry: () => unknown
}

type MessageActionsOptions = {
    chat: ChatLike
    caller: Caller | null
    endpoints: ChatEndpoints
    agentId: string
    coworkerName: string
    // Puts the words of the message being edited in the composer.
    onEdit: (text: string) => void
}

// The long press of a message: the same actions as the web's menu. An edit goes through the composer,
// with a line above it saying so.
export function useMessageActions({ chat, caller, endpoints, agentId, coworkerName, onEdit }: MessageActionsOptions) {
    const t = useTranslations('mobileChat.messageActions')
    const [editingId, setEditingId] = useState<string | null>(null)
    const live = useRef(chat)
    useEffect(() => {
        live.current = chat
    })

    const failed = (key: 'notReady' | 'failed' | 'busy') => Alert.alert(t(key))

    // The screen dropped the message and what followed before the hub answered; the machine kept them.
    // Its copy comes back, without the error card and its Retry, which would only append the new text.
    const { error } = chat
    useEffect(() => {
        const refusal = error ? messageEditRefusalOf(error.message) : null
        if (!refusal) return
        live.current.clearError()
        live.current.retry()
        Alert.alert(t(refusal === 'engineOutdated' ? 'engineOutdated' : 'failed'))
    }, [error, t])

    // A message streamed in this pane keeps the id the SDK gave it: the transcript is read again and
    // the message found in it by its turn.
    const withEngineId = async (messageId: string): Promise<{ list: UIMessage[]; id: string } | null> => {
        const { messages, sessionId, setMessages } = live.current
        const index = messages.findIndex(message => message.id === messageId)
        if (index < 0) return null
        if (engineMessageIdOf(messageId)) return { list: messages, id: messageId }
        if (!caller || !sessionId) return null
        const history = (await endpoints.messages(caller, sessionId, null).catch(() => null))?.messages
        const id = history ? counterpartIn(messages, index, history) : null
        if (!history || !id) return null
        setMessages(history)
        return { list: history, id }
    }

    const regenerateReply = useStableCallback(async (messageId: string) => {
        const { messages } = live.current
        const userAt = userIndexBefore(messages, messages.findIndex(message => message.id === messageId))
        if (userAt < 0) return
        const resolved = await withEngineId(messages[userAt].id)
        const at = resolved ? resolved.list.findIndex(message => message.id === resolved.id) : -1
        const engineId = resolved ? engineMessageIdOf(resolved.id) : null
        if (!resolved || at < 0 || !engineId) return failed('notReady')
        // The engine writes the message again under a new row: the id of the old one must not stay on it.
        live.current.setMessages([...resolved.list.slice(0, at), { ...resolved.list[at], id: generateId() }])
        live.current.regenerate({ replaceFrom: resolved.id })
    })

    // The composer's text takes the place of the message being edited, and of everything after it.
    const sendEdit = async (text: string): Promise<boolean> => {
        const messageId = editingId
        const message = live.current.messages.find(item => item.id === messageId)
        const editable = message ? editableTextOf(message) : null
        if (!messageId || !editable) return false
        const resolved = await withEngineId(messageId)
        const at = resolved ? resolved.list.findIndex(item => item.id === resolved.id) : -1
        const engineId = resolved ? engineMessageIdOf(resolved.id) : null
        if (!resolved || at < 0 || !engineId) {
            failed('notReady')
            return false
        }
        setEditingId(null)
        live.current.setMessages(resolved.list.slice(0, at))
        live.current.send(editable.rebuild(text), undefined, { replaceFrom: resolved.id })
        return true
    }

    const remove = async (messageId: string) => {
        const resolved = await withEngineId(messageId)
        const sessionId = live.current.sessionId
        if (!resolved || !caller || !sessionId) return failed('notReady')
        try {
            await deleteConversationMessage(caller, sessionId, resolved.id)
        } catch (error) {
            return Alert.alert(t('failed'), error instanceof Error ? error.message : undefined)
        }
        const list = live.current.messages
        const at = list.findIndex(message => message.id === resolved.id)
        if (at < 0) return
        const { start, end } = list[at].role === 'user' ? { start: at, end: at + 1 } : replyBounds(list, at)
        live.current.setMessages([...list.slice(0, start), ...list.slice(end)])
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }

    const confirmDelete = (message: UIMessage) =>
        Alert.alert(t('deleteTitle'), t(message.role === 'user' ? 'deleteUserDescription' : 'deleteReplyDescription', { name: coworkerName }), [
            { text: t('cancel'), style: 'cancel' },
            { text: t('delete'), style: 'destructive', onPress: () => void remove(message.id) },
        ])

    const copyLink = async (messageId: string) => {
        const resolved = await withEngineId(messageId)
        const sessionId = live.current.sessionId
        if (!resolved || !sessionId) return failed('notReady')
        await Clipboard.setStringAsync(messageLinkOf(environment.apiUrl, { agentId, sessionId, messageId: resolved.id }))
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }

    const open = useStableCallback((message: UIMessage) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        const isUser = message.role === 'user'
        const editable = isUser ? editableTextOf(message) : null
        const changing = (run: () => void) => () => (live.current.busy ? failed('busy') : run())
        const actions: { label: string; run: () => void }[] = []
        if (editable)
            actions.push({
                label: t('edit'),
                run: changing(() => {
                    setEditingId(message.id)
                    onEdit(editable.text)
                }),
            })
        if (!isUser) actions.push({ label: t('regenerate'), run: changing(() => void regenerateReply(message.id)) })
        actions.push({
            label: t('copy'),
            run: () => {
                Clipboard.setStringAsync(editable?.text ?? messageText(message))
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            },
        })
        actions.push({ label: t('copyLink'), run: () => void copyLink(message.id) })
        actions.push({ label: t('delete'), run: changing(() => confirmDelete(message)) })
        showActionSheet({ options: [...actions.map(action => action.label), t('cancel')], cancelButtonIndex: actions.length, destructiveButtonIndex: actions.length - 1 }, index => actions[index]?.run())
    })

    return { open, editingId, cancelEdit: () => setEditingId(null), sendEdit, regenerateReply }
}
