import { useLocalSearchParams } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ScreenCard } from '@/components/chat/screen/ScreenCard'
import { ScreenFace } from '@/components/chat/screen/ScreenFace'
import { FloatingScreen } from '@/components/chat/screen/FloatingScreen'
import type { TakeoverRequestState } from '@/components/chat/screen/useTakeoverRequest'
import { AppText } from '@/components/ui/AppText'
import { ThemeScope, useColorSchemeName } from '@/theme/theme'
import { palette, spacing, type ColorScheme } from '@/theme/tokens'

const noop = () => {}

const takeover = (opened: boolean, locked = false): TakeoverRequestState => ({ reason: 'Sign in to LinkedIn so I can read the shared list.', site: 'linkedin.com', opened, locked, finishing: locked, onOpen: noop, onSkip: noop, onDone: noop })

function FakeScreen() {
    return (
        <View style={{ flex: 1, backgroundColor: '#14121f' }}>
            <View style={{ height: '7%', backgroundColor: 'rgba(0,0,0,0.5)' }} />
            <View style={{ position: 'absolute', top: '14%', left: '8%', right: '8%', bottom: '14%', borderRadius: 4, overflow: 'hidden', backgroundColor: '#ffffff' }}>
                <View style={{ height: '12%', backgroundColor: '#e8e8ec' }} />
                <View style={{ padding: '4%', gap: 6 }}>
                    <View style={{ width: '40%', height: 8, borderRadius: 2, backgroundColor: '#0a66c2' }} />
                    {[0.9, 0.75, 0.82, 0.6].map(share => (
                        <View key={share} style={{ width: `${share * 100}%`, height: 5, borderRadius: 2, backgroundColor: '#d4d4d8' }} />
                    ))}
                </View>
            </View>
        </View>
    )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.md }}>
            <AppText variant="footnote" tone="muted" medium>
                {title}
            </AppText>
            {children}
        </View>
    )
}

export default function LabScreen() {
    const { scheme: forced } = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = forced === 'dark' || forced === 'light' ? forced : system
    const insets = useSafeAreaInsets()
    return (
        <ThemeScope scheme={scheme}>
            <View style={{ flex: 1, backgroundColor: palette[scheme].background }}>
                <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.xxl * 3, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.xl - 4, gap: spacing.xl }}>
                    <AppText variant="largeTitle">Screen</AppText>
                    <Group title="Live">
                        <ScreenCard live site="linkedin.com" screen={<FakeScreen />} onTakeControl={noop} />
                    </Group>
                    <Group title="Connecting">
                        <ScreenCard live={false} site={null} screen={<ScreenFace status="loading" />} onTakeControl={noop} />
                    </Group>
                    <Group title="Takeover asked">
                        <ScreenCard live site="linkedin.com" screen={<FakeScreen />} takeover={takeover(false)} onTakeControl={noop} />
                    </Group>
                    <Group title="Takeover open">
                        <ScreenCard live site="linkedin.com" screen={<FakeScreen />} takeover={takeover(true)} onTakeControl={noop} />
                    </Group>
                    <Group title="Takeover handing back">
                        <ScreenCard live site="linkedin.com" screen={<FakeScreen />} takeover={takeover(true, true)} onTakeControl={noop} />
                    </Group>
                    <Group title="Takeover, screen unavailable">
                        <ScreenCard live={false} site={null} screen={<ScreenFace status="error" />} takeover={takeover(false)} onTakeControl={noop} />
                    </Group>
                    <Group title="Screen went away">
                        <ScreenCard live={false} site={null} screen={<ScreenFace status="disconnected" />} onTakeControl={noop} />
                    </Group>
                </ScrollView>
                <FloatingScreen top={insets.top + spacing.sm} label="Take control" onTakeControl={noop}>
                    <FakeScreen />
                </FloatingScreen>
            </View>
        </ThemeScope>
    )
}
