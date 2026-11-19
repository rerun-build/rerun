import { useFonts } from 'expo-font'
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { StatusBar } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { BuddyClock } from '@/components/buddy/motion'
import { LAST_CONVERSATION } from '@/components/chat/ForemanChat'
import { AiConsent } from '@/components/consent/AiConsent'
import { NoPlan } from '@/components/home/NoPlan'
import { useIsSplit } from '@/components/layout/PaneSize'
import { sheetOptions } from '@/components/layout/sheet-options'
import { SplitShell } from '@/components/layout/SplitShell'
import { WaitlistNotice } from '@/components/onboarding/notices'
import { Onboarding } from '@/components/onboarding/Onboarding'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { useOnboardingRoute } from '@/components/onboarding/useOnboardingRoute'
import { SystemDialogHost } from '@/components/ui/system-dialogs'
import { UpdateRequired } from '@/components/update/UpdateRequired'
import { useUpdateRequired } from '@/components/update/useUpdateRequired'
import { MediaViewerHost } from '@/components/viewer/MediaViewerHost'
import { InboxProvider } from '@/data/InboxProvider'
import { I18nProvider } from '@/i18n/I18nProvider'
import { useAiConsent } from '@/lib/ai-consent'
import { posthog } from '@/lib/analytics'
import { MockStore } from '@/mocks/store'
import { OpenPushTarget, usePushTarget } from '@/notifications/PushRouting'
import { FrameMonitor } from '@/perf/FrameMonitor'
import { PERF_LOG } from '@/perf/timing'
import { useAppearanceLoaded } from '@/theme/appearance'
import { ReducedMotionOverride } from '@/theme/ReducedMotionOverride'
import { useColorSchemeName } from '@/theme/theme'
import { brand, palette } from '@/theme/tokens'

SplashScreen.preventAutoHideAsync()
SplashScreen.setOptions({ fade: true, duration: 250 })

function App() {
    const [fontsLoaded] = useFonts({
        'Inter-Regular': require('@/assets/fonts/Inter-Regular.ttf'),
        'Inter-Medium': require('@/assets/fonts/Inter-Medium.ttf'),
        'Inter-SemiBold': require('@/assets/fonts/Inter-SemiBold.ttf'),
        'Inter-Italic': require('@/assets/fonts/Inter-Italic.ttf'),
        'GeistMono-Regular': require('@/assets/fonts/GeistMono-Regular.ttf'),
    })
    const appearanceLoaded = useAppearanceLoaded()
    const scheme = useColorSchemeName()
    const updateRequired = useUpdateRequired()
    const { ready, session, me, refreshMe, signOut } = useAuth()
    const signedIn = Boolean(session)
    const inactiveWorkspace = signedIn && me !== null && !me.workspace.subscribed
    const { route, reload } = useOnboardingRoute()
    const settled = signedIn && me !== null
    const aiConsent = useAiConsent(session?.user.id ?? null)
    const consentKnown = !signedIn || aiConsent.state !== 'loading'
    // The onboarding just ended: the Chief of Staff's page opens once the app has taken over, and it
    // speaks first there. A wide window already opens on that page: a push would stack a second one.
    const [handedOver, setHandedOver] = useState(false)
    const split = useIsSplit()
    const pushTarget = usePushTarget()

    useEffect(() => {
        if (!handedOver || route.kind !== 'app') return
        const timer = setTimeout(() => {
            if (!split) router.push({ pathname: '/chat/[id]', params: { id: LAST_CONVERSATION } })
            setHandedOver(false)
        }, 0)
        return () => clearTimeout(timer)
    }, [handedOver, route.kind, split])

    const onOnboarded = async () => {
        setHandedOver(true)
        await refreshMe().catch(() => {})
        reload()
    }

    useEffect(() => {
        if (fontsLoaded && ready && appearanceLoaded && consentKnown) SplashScreen.hideAsync()
    }, [fontsLoaded, ready, appearanceLoaded, consentKnown])

    const pathname = usePathname()
    useEffect(() => {
        posthog.screen(pathname)
    }, [pathname])

    if (!fontsLoaded || !ready || !appearanceLoaded || !consentKnown) return null

    const base = scheme === 'dark' ? DarkTheme : DefaultTheme
    const navigationTheme = { ...base, colors: { ...base.colors, primary: brand.base, background: palette[scheme].background, card: palette[scheme].card, text: palette[scheme].foreground, border: palette[scheme].border } }

    return (
        <ThemeProvider value={navigationTheme}>
            {/* iOS picks the bar's ink from the appearance on its own; Android keeps light icons unless told. */}
            <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
            <BuddyClock>
                {updateRequired ? (
                    <UpdateRequired />
                ) : signedIn && aiConsent.state === 'needed' ? (
                    <OnboardingShell>
                        <AiConsent onAgree={aiConsent.grant} onDecline={() => void signOut()} />
                    </OnboardingShell>
                ) : settled && route.kind === 'onboarding' ? (
                    <OnboardingShell>
                        <Onboarding key={me.workspace.id} state={route.state} onDone={() => void onOnboarded()} onRefused={reload} />
                    </OnboardingShell>
                ) : settled && route.kind === 'waitlist' ? (
                    <OnboardingShell>
                        <WaitlistNotice />
                    </OnboardingShell>
                ) : inactiveWorkspace && route.kind === 'loading' ? (
                    <OnboardingShell>{null}</OnboardingShell>
                ) : inactiveWorkspace ? (
                    <NoPlan />
                ) : (
                    <MockStore>
                        <InboxProvider>
                            {signedIn && <OpenPushTarget href={pushTarget.href} onOpened={pushTarget.opened} />}
                            <SplitShell enabled={signedIn}>
                                <Stack screenOptions={{ headerShown: false }}>
                                    <Stack.Protected guard={signedIn} redirectTo="/sign-in">
                                        {/* Under a conversation, the Home does not draw again until it is back. */}
                                        <Stack.Screen name="index" options={{ freezeOnBlur: true }} />
                                        <Stack.Screen name="chat/[id]" />
                                        <Stack.Screen name="search" options={{ animation: 'fade' }} />
                                        <Stack.Screen name="coworker/[id]/index" />
                                        <Stack.Screen name="coworker/[id]/files" />
                                        <Stack.Screen name="coworker/[id]/apps" />
                                        <Stack.Screen name="coworker/[id]/routines" />
                                        <Stack.Screen name="coworker/[id]/notifications" />
                                        <Stack.Screen name="inbox" options={sheetOptions(scheme, [0.6, 1])} />
                                        <Stack.Screen name="model" options={sheetOptions(scheme, [0.6, 1])} />
                                        <Stack.Screen name="desktop" options={{ presentation: 'fullScreenModal' }} />
                                        <Stack.Screen name="settings" options={sheetOptions(scheme, [1])} />
                                        <Stack.Screen name="new-coworker" options={sheetOptions(scheme, [1])} />
                                        <Stack.Screen name="providers" options={sheetOptions(scheme, [1])} />
                                    </Stack.Protected>
                                    <Stack.Protected guard={!signedIn} redirectTo="/">
                                        <Stack.Screen name="sign-in" />
                                    </Stack.Protected>
                                    <Stack.Protected guard={__DEV__}>
                                        <Stack.Screen name="lab" />
                                        <Stack.Screen name="lab-chat" />
                                        <Stack.Screen name="lab-perf" />
                                        <Stack.Screen name="lab-threads" />
                                        <Stack.Screen name="lab-message-times" />
                                        <Stack.Screen name="lab-icons" />
                                        <Stack.Screen name="lab-controls" />
                                        <Stack.Screen name="lab-sign-in" />
                                        <Stack.Screen name="lab-hitl" />
                                        <Stack.Screen name="lab-screen" />
                                        <Stack.Screen name="lab-delegate" />
                                        <Stack.Screen name="lab-steps" />
                                        <Stack.Screen name="lab-skill" />
                                        <Stack.Screen name="lab-composer" />
                                        <Stack.Screen name="lab-foreman" />
                                        <Stack.Screen name="lab-home" />
                                        <Stack.Screen name="lab-markdown" />
                                        <Stack.Screen name="lab-onboarding" />
                                        <Stack.Screen name="lab-consent" />
                                        <Stack.Screen name="lab-splash" options={{ animation: 'none', gestureEnabled: true }} />
                                        <Stack.Screen name="lab-coworker" />
                                        <Stack.Screen name="lab-notifications" />
                                        <Stack.Screen name="lab-conversations" />
                                        <Stack.Screen name="lab-conversations-sheet" options={sheetOptions(scheme, [0.6, 1])} />
                                        <Stack.Screen name="lab-providers" options={sheetOptions(scheme, [1])} />
                                    </Stack.Protected>
                                </Stack>
                            </SplitShell>
                            <MediaViewerHost />
                            <SystemDialogHost />
                            {PERF_LOG && <FrameMonitor top={4} />}
                        </InboxProvider>
                    </MockStore>
                )}
            </BuddyClock>
        </ThemeProvider>
    )
}

export default function RootLayout() {
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            {/* Before App, whose first render waits on the fonts: the screens it mounts then already read it. */}
            <ReducedMotionOverride />
            <AuthProvider>
                <I18nProvider>
                    <App />
                </I18nProvider>
            </AuthProvider>
        </GestureHandlerRootView>
    )
}
