import { useLocalSearchParams } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PendingHitlPill } from '@/components/chat/hitl/PendingHitlPill'
import { QueuedMessagePill } from '@/components/chat/QueuedMessagePill'
import { Suggestions } from '@/components/chat/Suggestions'
import { SearchBar } from '@/components/home/SearchBar'
import { AppText } from '@/components/ui/AppText'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassSurface } from '@/components/ui/GlassSurface'
import { CircleTrigger, MenuItem, MenuSection, MenuToggle, NativeMenu, SubMenu } from '@/components/ui/NativeMenu'
import { ProgressiveBlur } from '@/components/ui/ProgressiveBlur'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ThemeScope, useTheme } from '@/theme/theme'
import { palette, radius, spacing, type ColorScheme } from '@/theme/tokens'

// Dev only: the controls that iOS draws with SwiftUI and glass, as each platform draws them.
//   /lab-controls   /lab-controls?scheme=dark

const noop = () => {}
const APPEARANCES = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
] as const

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={{ gap: spacing.sm }}>
            <AppText variant="footnote" tone="muted" medium>
                {title}
            </AppText>
            {children}
        </View>
    )
}

function Menus() {
    const theme = useTheme()
    const [workspace, setWorkspace] = useState('acme')
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}>
            <NativeMenu glass="circle" label="Account" trigger={<CircleTrigger symbol="user" />}>
                <SubMenu label="Workspaces" icon="layers">
                    <MenuToggle label="Acme" badge={{ initials: 'A' }} isOn={workspace === 'acme'} onChange={() => setWorkspace('acme')} />
                    <MenuToggle label="Atelier Nord" badge={{ initials: 'AN' }} isOn={workspace === 'nord'} onChange={() => setWorkspace('nord')} />
                </SubMenu>
                <MenuItem label="Preferences" icon="settings" onPress={noop} />
                <MenuItem label="Sign out" icon="log-out" destructive onPress={noop} />
            </NativeMenu>
            <NativeMenu
                glass="capsule"
                label="Conversations"
                trigger={
                    <View style={{ height: 44, justifyContent: 'center', paddingHorizontal: spacing.lg }}>
                        <AppText variant="headline">Conversations</AppText>
                    </View>
                }
            >
                <MenuItem label="Coworker details" icon="info" onPress={noop} />
                <MenuItem label="New conversation" icon="plus" disabled onPress={noop} />
                <MenuSection title="Needs you">
                    <MenuItem label="CV to send" icon="message-circle-question-fill" subtitle="Which CV should I send?" onPress={noop} />
                    <MenuToggle label="Weekly report" isOn onChange={noop} />
                </MenuSection>
            </NativeMenu>
            <NativeMenu
                label="Attach"
                trigger={
                    <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                        <AppText variant="headline">+</AppText>
                    </View>
                }
            >
                <MenuItem label="Photos" icon="images" onPress={noop} />
                <MenuItem label="Camera" icon="camera" onPress={noop} />
                <MenuItem label="Files" icon="folder" onPress={noop} />
            </NativeMenu>
        </View>
    )
}

function Controls() {
    const theme = useTheme()
    const [appearance, setAppearance] = useState<(typeof APPEARANCES)[number]['value']>('system')
    return (
        <View style={{ gap: spacing.xl }}>
            <Group title="Menus (tap a trigger)">
                <Menus />
            </Group>
            <Group title="Segmented picker">
                <SegmentedControl options={APPEARANCES} value={appearance} onChange={setAppearance} />
            </Group>
            <Group title="Buttons and surfaces">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <GlassButton symbol="chevron-left" label="Back" onPress={noop} />
                    <GlassButton symbol="x" label="Close" onPress={noop} />
                    <GlassSurface colorScheme={theme.scheme} style={{ borderRadius: 20, height: 40, paddingHorizontal: spacing.lg, justifyContent: 'center' }}>
                        <AppText variant="callout">A pill on a surface</AppText>
                    </GlassSurface>
                </View>
                <SearchBar onPress={noop} />
            </Group>
            <Group title="Above the composer">
                <View style={{ marginHorizontal: -spacing.lg }}>
                    <Suggestions items={['Show me the leads', 'Make it weekly instead', 'Stop here']} onPick={noop} />
                </View>
                <QueuedMessagePill text="And send the recap to the team" busy pending={false} onSendNow={noop} onDiscard={noop} />
                <View style={{ alignItems: 'center' }}>
                    <PendingHitlPill kind="question" input={{ questions: [{ question: 'Which CV should I send?' }] }} onJump={noop} />
                </View>
            </Group>
            <Group title="Fade under a bar">
                <View style={{ height: 140, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: theme.card }}>
                    {Array.from({ length: 6 }, (_, line) => (
                        <AppText key={line} style={{ paddingHorizontal: spacing.lg }}>
                            {`Line ${line + 1} of the conversation scrolling under the composer`}
                        </AppText>
                    ))}
                    <ProgressiveBlur height={90} />
                </View>
            </Group>
        </View>
    )
}

export default function LabControls() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const insets = useSafeAreaInsets()
    const scheme: ColorScheme = params.scheme === 'dark' ? 'dark' : 'light'
    return (
        <ThemeScope scheme={scheme}>
            <ScrollView style={{ flex: 1, backgroundColor: palette[scheme].background }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
                <Controls />
            </ScrollView>
        </ThemeScope>
    )
}
