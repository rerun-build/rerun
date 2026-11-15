import type { AuthorProfile } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { useLocalSearchParams } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MessageView } from '@/components/chat/MessageView'
import { TimedTurns } from '@/components/chat/TimedTurns'
import { ThemeScope } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

import { WIDE_TABLE } from './lab-markdown'

const at = (daysAgo: number, hour: number, minute = 0) => {
    const date = new Date()
    date.setDate(date.getDate() - daysAgo)
    date.setHours(hour, minute, 0, 0)
    return date.toISOString()
}

const message = (id: string, role: 'user' | 'assistant', text: string, createdAt: string, authorId?: string): UIMessage => ({ id, role, parts: [{ type: 'text', text }], metadata: { createdAt, ...(authorId && { authorId }) } })

const THREAD: UIMessage[] = [
    message('m1', 'user', 'Can you pull the September numbers?', at(12, 9, 12), 'u-clement'),
    message('m2', 'assistant', 'September closed at **€41k**, 58% from inbound.', at(12, 9, 13)),
    message('m3', 'user', 'Draft the LinkedIn post on pricing', at(4, 16, 40), 'u-clement'),
    message('m4', 'assistant', 'Here is a first draft. It opens on the 3 plans and ends on the free trial.', at(4, 16, 42)),
    message('m5', 'user', 'Post it tomorrow at 9', at(1, 21, 5), 'u-margaux'),
    message('m6', 'assistant', 'Scheduled for 9:00 AM.', at(1, 21, 5)),
    message('m7', 'user', 'Did it go out?', at(0, 8, 30), 'u-clement'),
    message('m8', 'assistant', 'Yes, at 9:00. 1,204 views so far.', at(0, 10, 2)),
    message('m9', 'user', 'Nice', at(0, 11, 30), 'u-clement'),
    message('m10', 'user', 'Same for next week', at(0, 11, 31), 'u-clement'),
    message('m11', 'assistant', `The leads worth a call:\n\n${WIDE_TABLE}`, at(0, 11, 32)),
]

const PROFILES: Record<string, AuthorProfile> = {
    'u-clement': { id: 'u-clement', name: 'Clément Janssens', photo: 'https://i.pravatar.cc/120?img=12' },
    'u-margaux': { id: 'u-margaux', name: 'Margaux Petit' },
}

export default function LabMessageTimes() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const insets = useSafeAreaInsets()
    const scheme: ColorScheme = params.scheme === 'dark' ? 'dark' : 'light'
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ flex: 1, backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingHorizontal: spacing.xl - 4, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
                <View style={{ gap: spacing.xl }}>
                    <TimedTurns messages={THREAD} authorOf={authorId => PROFILES[authorId]} renderMessage={(item, index, stamp) => <MessageView key={item.id} message={item} isLastAssistant={false} running={false} agentId="agent-scout" fileOwner={null} coworkerName="Scout" hiddenCallId={null} stamp={stamp} />} />
                </View>
            </ScrollView>
        </ThemeScope>
    )
}
