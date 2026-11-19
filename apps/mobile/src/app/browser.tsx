import * as Clipboard from 'expo-clipboard'
import { Redirect, router } from 'expo-router'
import { useRef, useState } from 'react'
import { Linking, Platform, Pressable, Share, StatusBar, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { useTranslations } from 'use-intl'

import { BrowserBar } from '@/components/browser/BrowserBar'
import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { MenuItem } from '@/components/ui/NativeMenu'
import * as Haptics from '@/lib/haptics'
import { takePendingBrowserOpen, type LinkOrigin } from '@/lib/in-app-browser'
import { useSystemBack } from '@/lib/system-back'
import { hostOf, isWebUrl } from '@/lib/url'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

const DISMISS_DISTANCE = 120
const DISMISS_VELOCITY = 800
const PEEK_AVATAR = 28

// Rerun's own browser, after X's: the page rises over the conversation, the message the link was read
// in stays under it, and a glass bar floats at the foot of the page. It shares no session with the
// phone's browser, so its menu hands the page over to it.
export default function Browser() {
    const [open] = useState(takePendingBrowserOpen)
    if (!open || !isWebUrl(open.url)) return <Redirect href="/" />
    return <BrowserPage url={open.url} from={open.from} />
}

function BrowserPage({ url, from }: { url: string; from?: LinkOrigin }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const t = useTranslations('mobileChat.browser')
    const page = useRef<WebView<object>>(null)
    const [current, setCurrent] = useState(url)
    const [canGoBack, setCanGoBack] = useState(false)
    const host = hostOf(current) ?? current
    const drag = useSharedValue(0)

    const close = () => router.back()

    // Android's back gesture steps back through the page's history first, as a browser does.
    useSystemBack(canGoBack, () => page.current?.goBack())

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
    const [peekPull] = useState(pullDown)

    const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }))

    const onNavigate = (navigation: WebViewNavigation) => {
        setCanGoBack(navigation.canGoBack)
        if (isWebUrl(navigation.url)) setCurrent(navigation.url)
    }

    // A page can link to a phone number, a mail or an app: the system takes those, the frame keeps the web.
    // An iframe of the page (about:srcdoc, data:, blob:) loads where it is; only iOS says which frame asks.
    const onShouldStartLoad = (request: ShouldStartLoadRequest) => {
        if (request.isTopFrame === false) return true
        if (isWebUrl(request.url) || request.url === 'about:blank') return true
        Linking.openURL(request.url).catch(() => {})
        return false
    }

    const copyLink = () => {
        Clipboard.setStringAsync(current)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingBottom: from ? 0 : insets.bottom }}>
            {/* The band under the notch is white whatever the theme: its ink stays dark. */}
            <StatusBar barStyle="dark-content" />
            <Animated.View style={[{ flex: 1, overflow: 'hidden', backgroundColor: '#ffffff', paddingTop: insets.top }, pageStyle]}>
                <WebView ref={page} source={{ uri: url }} style={{ flex: 1 }} originWhitelist={['*']} onNavigationStateChange={onNavigate} onShouldStartLoadWithRequest={onShouldStartLoad} allowsBackForwardNavigationGestures setSupportMultipleWindows={false} />
                <GestureDetector gesture={barPull}>
                    <View style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: from ? spacing.md + radius.xl : spacing.md }}>
                        <BrowserBar host={host} labels={{ close: t('close'), reload: t('reload'), pageActions: t('pageActions', { host }) }} onClose={close} onReload={() => page.current?.reload()}>
                            <MenuItem label={t('share')} icon="share" onPress={() => Share.share(Platform.OS === 'ios' ? { url: current } : { message: current })} />
                            <MenuItem label={t('openInBrowser')} icon="globe" onPress={() => Linking.openURL(current).catch(() => {})} />
                            <MenuItem label={t('copyLink')} icon="copy" onPress={copyLink} />
                        </BrowserBar>
                    </View>
                </GestureDetector>
            </Animated.View>
            {from ? (
                <GestureDetector gesture={peekPull}>
                    <MessagePeek from={from} onBack={close} />
                </GestureDetector>
            ) : null}
        </View>
    )
}

// The message the link came from, kept under the page: who wrote it, then its first line.
function MessagePeek({ from, onBack }: { from: LinkOrigin; onBack: () => void }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const t = useTranslations('mobileChat.browser')
    const { author, excerpt } = from
    return (
        <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('backToChat')}
            style={{
                marginTop: -radius.xl,
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.sm,
                paddingBottom: insets.bottom + spacing.sm,
                gap: spacing.sm,
                backgroundColor: theme.card,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                borderCurve: 'continuous',
                boxShadow: '0 -6px 16px -10px rgba(0,0,0,0.3)',
            }}
        >
            <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: radius.pill, backgroundColor: theme.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <CoworkerAvatar coworker={{ id: author.id, kind: author.kind, status: 'idle' }} size={PEEK_AVATAR} animated={false} facing="right" />
                <View style={{ flex: 1 }}>
                    <AppText variant="footnote" medium numberOfLines={1}>
                        {author.name}
                    </AppText>
                    {author.role ? (
                        <AppText variant="caption" tone="muted" numberOfLines={1}>
                            {author.role}
                        </AppText>
                    ) : null}
                </View>
                <AppText variant="footnote" medium>
                    {t('brand')}
                </AppText>
            </View>
            <AppText variant="callout" numberOfLines={1}>
                {excerpt}
            </AppText>
        </Pressable>
    )
}
