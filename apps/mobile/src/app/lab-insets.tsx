import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'

import { NoPlan } from '@/components/home/NoPlan'
import { PaneSizeProvider } from '@/components/layout/PaneSize'
import { sidebarWidth } from '@/components/layout/split'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { AppText } from '@/components/ui/AppText'
import { ThemeScope, useColorSchemeName, useTheme } from '@/theme/theme'
import { spacing, type ColorScheme } from '@/theme/tokens'

import ChatLab from './lab-chat'
import { DetailsLab } from './lab-coworker'
import { MockHome } from './lab-home'

// Dev only: the screens under forced horizontal safe-area insets (a landscape phone with a cutout, which
// no supported orientation gives today), alone or in the detail column beside the Home sidebar.
//   /lab-insets?screen=home|coworker|chat|onboarding|noplan&split=1&inset=44&scheme=dark

type LabScreen = 'home' | 'coworker' | 'chat' | 'onboarding' | 'noplan'

function Screen({ screen }: { screen: LabScreen }) {
    if (screen === 'home') return <MockHome pinCount={3} />
    if (screen === 'coworker') return <DetailsLab state="normal" />
    if (screen === 'chat') return <ChatLab />
    if (screen === 'noplan') return <NoPlan />
    return (
        <OnboardingShell>
            <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl }}>
                <AppText variant="callout" tone="muted" style={{ textAlign: 'center' }}>
                    The onboarding body keeps the shell's side insets.
                </AppText>
            </View>
        </OnboardingShell>
    )
}

function SplitLab({ screen }: { screen: LabScreen }) {
    const theme = useTheme()
    const { width } = useWindowDimensions()
    return (
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.background }}>
            <PaneSizeProvider side="sidebar" style={{ flex: 0, width: sidebarWidth(width), borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: theme.border }}>
                <MockHome pinCount={3} />
            </PaneSizeProvider>
            <PaneSizeProvider side="detail">
                <Screen screen={screen} />
            </PaneSizeProvider>
        </View>
    )
}

export default function InsetsLab() {
    const params = useLocalSearchParams<{ screen?: LabScreen; split?: string; inset?: string; scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : system
    const screen = params.screen ?? 'home'
    const inset = Number(params.inset ?? 44)
    return (
        <ThemeScope scheme={scheme}>
            <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: inset, right: inset }}>{params.split === '1' ? <SplitLab screen={screen} /> : <Screen screen={screen} />}</SafeAreaInsetsContext.Provider>
        </ThemeScope>
    )
}
