import { ROUTE_ID_PATTERN } from '@rerun/contracts'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { BackHandler, Pressable, TextInput, View } from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useTranslations } from 'use-intl'

import { finishTakeover, openDesktop, startTakeover } from '@/api/desktop'
import { useAuth } from '@/auth/AuthProvider'
import { usePaneInsets } from '@/components/layout/PaneSize'
import { AppText } from '@/components/ui/AppText'
import { Icon } from '@/components/ui/Icon'
import { PillButton } from '@/components/ui/PillButton'
import { environment } from '@/config/environment'
import { handBack } from '@/desktop/hand-back'
import { takePendingDesktopOpen } from '@/desktop/pending-open'
import { DESKTOP_KEYS, keyScript, typeScript, viewerUrl } from '@/desktop/viewer'
import * as Haptics from '@/lib/haptics'
import { fonts, radius, spacing } from '@/theme/tokens'

const SCREEN_BACKGROUND = '#000000'
const MAX_RECONNECTS = 3

type Connection = { state: 'connecting' } | { state: 'open'; uri: string } | { state: 'failed'; reason: 'unreachable' | 'dropping'; message?: string }

function messageTypeOf(data: string): string | null {
    try {
        const parsed: unknown = JSON.parse(data)
        return typeof parsed === 'object' && parsed !== null && 'type' in parsed && typeof parsed.type === 'string' ? parsed.type : null
    } catch {
        return null
    }
}

function KeyButton({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ paddingHorizontal: spacing.md, height: 36, justifyContent: 'center', borderRadius: radius.md, backgroundColor: pressed ? '#3a3a3a' : '#262626' })}>
            <AppText variant="footnote" medium style={{ color: '#fafafa' }}>
                {label}
            </AppText>
        </Pressable>
    )
}

// A coworker's screen, driven from the phone. The page that opens it leaves what for in memory: with
// `call`, it answers a takeover, the coworker's own browser opens on `url`, and Done hands it back with
// the page it was left on. Only the coworker comes from the route, so a link can at most show a screen.
// A phone's keyboard cannot reach the screen's canvas, so text is typed here and sent there key by key.
export default function Desktop() {
    const { agent } = useLocalSearchParams<{ agent: string }>()
    const [intent] = useState(() => takePendingDesktopOpen(agent))
    const name = intent?.name
    const call = intent?.call
    const url = intent?.url
    const insets = useSafeAreaInsets()
    const pane = usePaneInsets()
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const [connection, setConnection] = useState<Connection>({ state: 'connecting' })
    const [text, setText] = useState('')
    const [finishing, setFinishing] = useState(false)
    const t = useTranslations('mobileChat.desktop')
    const tc = useTranslations('mobileCommon.actions')
    const web = useRef<WebView<object>>(null)
    const reconnects = useRef(0)
    const started = useRef(false)
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id

    const requestScreen = useCallback(async (): Promise<Connection> => {
        if (!accessToken || !workspaceId || !ROUTE_ID_PATTERN.test(agent)) return { state: 'connecting' }
        const who = { accessToken, workspaceId }
        try {
            if (call && !started.current) {
                await startTakeover(who, agent, url || undefined)
                started.current = true
            }
            const { socketUrl } = await openDesktop(who, agent, 'drive')
            return { state: 'open', uri: viewerUrl(socketUrl, 'drive') }
        } catch (err) {
            return { state: 'failed', reason: 'unreachable', message: err instanceof Error ? err.message : undefined }
        }
    }, [accessToken, workspaceId, agent, call, url])

    useEffect(() => {
        requestScreen().then(setConnection)
    }, [requestScreen])

    const reconnect = () => {
        setConnection({ state: 'connecting' })
        requestScreen().then(setConnection)
    }

    // A dropped socket is reopened with a fresh ticket, a few times, before saying so.
    const onMessage = (event: WebViewMessageEvent) => {
        const type = messageTypeOf(event.nativeEvent.data)
        if (type === 'connected') reconnects.current = 0
        if (type !== 'disconnected') return
        reconnects.current += 1
        if (reconnects.current > MAX_RECONNECTS) setConnection({ state: 'failed', reason: 'dropping' })
        else reconnect()
    }

    const done = async () => {
        if (!call) {
            router.back()
            return
        }
        if (!caller) return
        setFinishing(true)
        try {
            handBack(call, await finishTakeover(caller, agent, { keepOpen: true }))
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            router.back()
        } catch {
            setFinishing(false)
        }
    }

    // Android's back is Done: a takeover is handed back to the coworker rather than left waiting on a
    // screen nobody holds any more.
    const onBack = useEffectEvent(() => {
        if (!finishing) void done()
        return true
    })
    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', onBack)
        return () => subscription.remove()
    }, [])

    const typeText = () => {
        if (!text) return
        web.current?.injectJavaScript(typeScript(text))
        setText('')
    }

    const keyboard = useAnimatedKeyboard()
    const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, insets.bottom) + spacing.sm }))

    if (!ROUTE_ID_PATTERN.test(agent)) return <Redirect href="/" />
    return (
        <View style={{ flex: 1, backgroundColor: SCREEN_BACKGROUND }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: insets.top + spacing.sm, paddingLeft: spacing.lg + pane.left, paddingRight: spacing.lg + pane.right, paddingBottom: spacing.sm }}>
                <Icon name="monitor" size={16} color="#a1a1a1" />
                <AppText variant="headline" numberOfLines={1} style={{ flex: 1, color: '#fafafa' }}>
                    {name ? t('screenOf', { name }) : t('screen')}
                </AppText>
                <PillButton label={call ? (finishing ? t('handingBack') : tc('done')) : tc('close')} onPress={done} loading={finishing} />
            </View>

            <View style={{ flex: 1 }}>
                {connection.state === 'open' && <WebView ref={web} source={{ uri: connection.uri }} onMessage={onMessage} style={{ flex: 1, backgroundColor: SCREEN_BACKGROUND }} bounces={false} scrollEnabled={false} originWhitelist={[environment.apiUrl]} />}
                {connection.state === 'connecting' && (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <AppText variant="callout" style={{ color: '#a1a1a1' }}>
                            {t('connecting')}
                        </AppText>
                    </View>
                )}
                {connection.state === 'failed' && (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl }}>
                        <AppText variant="callout" style={{ color: '#a1a1a1', textAlign: 'center' }}>
                            {connection.message ?? t(connection.reason)}
                        </AppText>
                        <PillButton
                            label={t('retry')}
                            variant="secondary"
                            onPress={() => {
                                reconnects.current = 0
                                reconnect()
                            }}
                        />
                    </View>
                )}
            </View>

            <Animated.View style={[{ gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm }, lift]}>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    {Object.values(DESKTOP_KEYS).map(key => (
                        <KeyButton key={key.code} label={t(`keys.${key.labelKey}`)} onPress={() => web.current?.injectJavaScript(keyScript(key.keysym, key.code))} />
                    ))}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <TextInput
                        value={text}
                        onChangeText={setText}
                        onSubmitEditing={typeText}
                        placeholder={t('typePlaceholder')}
                        placeholderTextColor="#737373"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="send"
                        testID="desktop-input"
                        style={{ flex: 1, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: '#262626', color: '#fafafa', fontFamily: fonts.regular, fontSize: 16 }}
                    />
                    <Pressable onPress={typeText} accessibilityRole="button" accessibilityLabel={t('type')} style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafafa', opacity: pressed ? 0.7 : 1 })}>
                        <Icon name="arrow-up" size={16} bold color="#0a0a0a" />
                    </Pressable>
                </View>
            </Animated.View>
        </View>
    )
}
