import * as Clipboard from 'expo-clipboard'
import { Redirect, router } from 'expo-router'
import { useRef, useState } from 'react'
import { Linking, Pressable, Share, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { useTranslations } from 'use-intl'

import { AppText } from '@/components/ui/AppText'
import { GLASS_BUTTON_SIZE, GlassButton } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import { MenuItem, NativeMenu } from '@/components/ui/NativeMenu'
import * as Haptics from '@/lib/haptics'
import { takePendingBrowserOpen } from '@/lib/in-app-browser'
import { hostOf, isWebUrl } from '@/lib/url'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

const DISMISS_DISTANCE = 120
const DISMISS_VELOCITY = 800

// Rerun's own browser, after X's: the page rises over the conversation, the message the link was read
// in stays under it, and a glass bar floats at the foot of the page. It shares no session with the
// phone's browser, so its menu hands the page over to it.
export default function Browser() {
    const [open] = useState(takePendingBrowserOpen)
    if (!open || !isWebUrl(open.url)) return <Redirect href="/" />
    return <BrowserPage url={open.url} excerpt={open.excerpt} />
}

function BrowserPage({ url, excerpt }: { url: string; excerpt?: string }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const t = useTranslations('mobileChat.browser')
    const page = useRef<WebView<object>>(null)
    const [current, setCurrent] = useState(url)
    const host = hostOf(current) ?? current
    const drag = useSharedValue(0)

    const close = () => router.back()

    // Pulling the bar or the message down lets the page go, as a sheet would. A gesture attaches to
    // one view only, so each gets its own.
    const pullDown = () =>
        Gesture.Pan()
            .activeOffsetY(10)
            .onUpdate(event => {
                drag.value = Math.max(0, event.translationY)
            })
            .onEnd(event => {
                if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) runOnJS(close)()
                else drag.value = withSpring(0)
            })
    const [barPull] = useState(pullDown)
    const [excerptPull] = useState(pullDown)

    const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }))

    const onNavigate = (navigation: WebViewNavigation) => {
        if (isWebUrl(navigation.url)) setCurrent(navigation.url)
    }

    // A page can link to a phone number, a mail or an app: the system takes those, the frame keeps the web.
    const onShouldStartLoad = (request: ShouldStartLoadRequest) => {
        if (isWebUrl(request.url) || request.url === 'about:blank') return true
        Linking.openURL(request.url).catch(() => {})
        return false
    }

    const copyLink = () => {
        Clipboard.setStringAsync(current)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingBottom: excerpt ? 0 : insets.bottom }}>
            <Animated.View style={[{ flex: 1, overflow: 'hidden', backgroundColor: '#ffffff', paddingTop: insets.top, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, borderCurve: 'continuous' }, pageStyle]}>
                <WebView ref={page} source={{ uri: url }} style={{ flex: 1 }} onNavigationStateChange={onNavigate} onShouldStartLoadWithRequest={onShouldStartLoad} allowsBackForwardNavigationGestures setSupportMultipleWindows={false} />
                <GestureDetector gesture={barPull}>
                    <View style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                        <GlassButton symbol="x" label={t('close')} onPress={close} />
                        <NativeMenu
                            glass="capsule"
                            label={t('pageActions', { host })}
                            trigger={
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: GLASS_BUTTON_SIZE, maxWidth: 220, paddingHorizontal: spacing.lg }}>
                                    <AppText variant="footnote" medium numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flexShrink: 1 }}>
                                        {host}
                                    </AppText>
                                    <Icon name="ellipsis" size={14} color={theme.mutedForeground} />
                                </View>
                            }
                        >
                            <MenuItem label={t('share')} icon="share" onPress={() => Share.share({ url: current, message: current })} />
                            <MenuItem label={t('openInBrowser')} icon="globe" onPress={() => Linking.openURL(current).catch(() => {})} />
                            <MenuItem label={t('copyLink')} icon="copy" onPress={copyLink} />
                        </NativeMenu>
                        <GlassButton symbol="refresh-cw" label={t('reload')} onPress={() => page.current?.reload()} />
                    </View>
                </GestureDetector>
            </Animated.View>
            {excerpt ? (
                <GestureDetector gesture={excerptPull}>
                    <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('backToChat')} style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.md, gap: spacing.sm }}>
                        <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: radius.pill, backgroundColor: theme.border }} />
                        <AppText variant="callout" numberOfLines={2}>
                            {excerpt}
                        </AppText>
                    </Pressable>
                </GestureDetector>
            ) : null}
        </View>
    )
}
