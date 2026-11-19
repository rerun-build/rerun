import { PUSH_CATEGORIES, type PushCategory, type PushData } from '@rerun/contracts'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'

import { CoworkerPage } from '@/components/coworker/CoworkerPage'
import { AppText } from '@/components/ui/AppText'
import { Button } from '@/components/ui/Button'
import { registerPushCategories } from '@/notifications/categories'
import { spacing } from '@/theme/tokens'

// Dev only: a push with its buttons, as the hub sends it, without a hub. A simulator in the cloud
// gets no push token, so the push is a local one with the same category and data.
//   /lab-push-actions

type LabPush = { label: string; title: string; subtitle: string; body: string; categoryId: PushCategory; data: PushData }

const PUSHES: LabPush[] = [
    { label: 'Approval', title: 'Closer', subtitle: 'Needs approval', body: 'Send the 12 follow-up emails?', categoryId: PUSH_CATEGORIES.approval, data: { agentId: 'agent-closer', conversationId: 'lab-conversation', kind: 'approval', toolCallId: 'lab-call' } },
    { label: 'Question', title: 'Scout', subtitle: 'Question', body: 'Which list first, the French or the Spanish one?', categoryId: PUSH_CATEGORIES.question, data: { agentId: 'agent-scout', conversationId: 'lab-conversation', kind: 'question', toolCallId: 'lab-call' } },
    { label: 'Finished task', title: 'Ledger', subtitle: 'Done', body: 'The October report is ready.', categoryId: PUSH_CATEGORIES.reply, data: { agentId: 'agent-ledger', conversationId: 'lab-conversation', kind: 'done' } },
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
