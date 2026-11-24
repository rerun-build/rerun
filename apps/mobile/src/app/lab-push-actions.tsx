import { PUSH_CATEGORIES, type PushCategory, type PushData } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'

import { CoworkerPage } from '@/components/coworker/CoworkerPage'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { environment } from '@/config/environment'
import { registerPushCategories } from '@/notifications/categories'
import { spacing } from '@/theme/tokens'

// Dev only: a push with its buttons and its coworker, as the hub sends it. A simulator in the cloud gets
// no push token, so the push is a local one with the same category and data: Android draws its portrait,
// iOS only does for a push that came from outside.
//   /lab-push-actions

type LabPush = { label: string; title: string; subtitle: string; body: string; categoryId: PushCategory; data: PushData }

const senderOf = (name: string, look: string, state: string) => ({ name, state, image: `${environment.apiUrl}/og/coworker/${look}` })

const PUSHES: LabPush[] = [
    { label: 'Approval', title: 'Closer', subtitle: 'Needs approval', body: 'Send the 12 follow-up emails?', categoryId: PUSH_CATEGORIES.approval, data: { agentId: 'agent-closer', conversationId: 'lab-conversation', kind: 'approval', toolCallId: 'lab-call', sender: senderOf('Closer', 'shades-flat-0f52ff-clay', 'Needs approval') } },
    { label: 'Question', title: 'Scout', subtitle: 'Question', body: 'Which list first, the French or the Spanish one?', categoryId: PUSH_CATEGORIES.question, data: { agentId: 'agent-scout', conversationId: 'lab-conversation', kind: 'question', toolCallId: 'lab-call', sender: senderOf('Scout', 'heart-cat-f0127f-knit', 'Question') } },
    { label: 'Finished task', title: 'Ledger', subtitle: 'Done', body: 'The October report is ready.', categoryId: PUSH_CATEGORIES.reply, data: { agentId: 'agent-ledger', conversationId: 'lab-conversation', kind: 'done', sender: senderOf('Ledger', 'glasses-smile-4fb800-classic', 'Done') } },
    { label: 'Chief of Staff', title: 'Max', subtitle: 'Info', body: 'Your invoices coworker failed three nights in a row.', categoryId: PUSH_CATEGORIES.reply, data: { agentId: 'foreman', conversationId: 'lab-conversation', kind: 'info', sender: senderOf('Max', 'foreman', 'Info') } },
    { label: 'No text', title: 'Ledger · Done', subtitle: '', body: '', categoryId: PUSH_CATEGORIES.reply, data: { agentId: 'agent-ledger', conversationId: 'lab-conversation', kind: 'done', sender: senderOf('Ledger', 'glasses-smile-4fb800-classic', 'Morning brief · Done') } },
    { label: 'No picture', title: 'Scout', subtitle: 'Question', body: 'Its picture cannot be loaded.', categoryId: PUSH_CATEGORIES.reply, data: { agentId: 'agent-scout', conversationId: 'lab-conversation', kind: 'question', sender: senderOf('Scout', 'nobody', 'Question') } },
]

export default function LabPushActions() {
    const [status, setStatus] = useState<string>('')

    async function send(push: LabPush) {
        await registerPushCategories()
        const { status: permission } = await Notifications.requestPermissionsAsync()
        if (permission !== 'granted') return setStatus(`Notifications ${permission}`)
        await Notifications.scheduleNotificationAsync({
            content: { title: push.title, subtitle: push.subtitle, body: push.body, categoryIdentifier: push.categoryId, data: push.data },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
        })
        setStatus(`${push.label} in 3 s`)
    }

    return (
        <CoworkerPage title="Push buttons" onBack={() => router.back()}>
            <View style={{ gap: spacing.md, padding: spacing.lg }}>
                {PUSHES.map(push => (
                    <Button key={push.label} label={push.label} onPress={() => void send(push)} />
                ))}
                <AppText tone="muted">{status}</AppText>
            </View>
        </CoworkerPage>
    )
}
