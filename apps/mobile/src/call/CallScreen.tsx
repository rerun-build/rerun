import { router } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StatusBar, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar } from '@/components/ui/CoworkerAvatar'
import { GlassButton } from '@/components/ui/GlassButton'
import { Icon } from '@/components/ui/Icon'
import type { CoworkerStatus } from '@/mocks/data'
import { ThemeScope, useTheme } from '@/theme/theme'
import { brand, fonts, radius, spacing } from '@/theme/tokens'

import type { CallPhase, CallSession, CallState, TurnTiming } from './call-session'
import { callLanguages, useCall } from './useCall'

const AVATAR = 128
const AURA = 300
const HANG_UP = 72
const SHOWN_TURNS = 6
const RINGS = [
    { reach: 0.3, opacity: 0.3 },
    { reach: 0.62, opacity: 0.18 },
    { reach: 1, opacity: 0.1 },
]
const BREATH = { duration: 750, easing: Easing.inOut(Easing.quad) }

const STATUS: Record<CallPhase, string> = { ringing: 'Calling…', listening: 'Listening', thinking: 'Thinking…', speaking: '', blocked: 'Call unavailable' }
const MOOD: Record<CallPhase, CoworkerStatus> = { ringing: 'waiting_human', listening: 'idle', thinking: 'working', speaking: 'idle', blocked: 'error' }

function ms(value: number | null): string {
    return value === null ? '-' : String(value)
}

function average(turns: TurnTiming[]): number | null {
    const totals = turns.map(turn => turn.totalMs).filter((total): total is number => total !== null)
    return totals.length ? Math.round(totals.reduce((sum, total) => sum + total, 0) / totals.length) : null
}

function clock(elapsedMs: number): string {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function Ring({ level, reach, opacity }: { level: SharedValue<number>; reach: number; opacity: number }) {
    const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + level.get() * reach }], opacity: opacity * (0.3 + 0.7 * level.get()) }))
    return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: brand.soft }, style]} />
}

// The halo around the coworker: it breathes while the call waits (ringing, thinking), follows the
// caller's voice while they talk and beats on each word the coworker says.
function CallAura({ session, phase, children }: { session: CallSession; phase: CallPhase; children: ReactNode }) {
    const level = useSharedValue(0)
    const waiting = phase === 'ringing' || phase === 'thinking'

    useEffect(() => {
        session.onLevel(value => level.set(withSequence(withTiming(value, { duration: 70 }), withTiming(value * 0.3, { duration: 320 }))))
        return () => session.onLevel(null)
    }, [session, level])

    useEffect(() => {
        level.set(waiting ? withRepeat(withSequence(withTiming(0.85, BREATH), withTiming(0.1, BREATH)), -1) : withTiming(0, { duration: 250 }))
    }, [waiting, level])

    return (
        <View style={{ width: '100%', maxWidth: AURA, aspectRatio: 1, maxHeight: '100%', alignItems: 'center', justifyContent: 'center' }}>
            {RINGS.map(ring => (
                <Ring key={ring.reach} level={level} reach={ring.reach} opacity={ring.opacity} />
            ))}
            {children}
        </View>
    )
}

function CallClock({ since }: { since: number }) {
    const [now, setNow] = useState(since)
    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(tick)
    }, [])
    return (
        <AppText variant="callout" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
            {clock(now - since)}
        </AppText>
    )
}

function Setting({ label, onPress }: { label: string; onPress: () => void }) {
    const theme = useTheme()
    return (
        <Pressable onPress={onPress} hitSlop={8} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: theme.secondary }}>
            <AppText variant="footnote" medium>
                {label}
            </AppText>
        </Pressable>
    )
}

function Stats({ state, session, model }: { state: CallState; session: CallSession; model: string }) {
    const theme = useTheme()
    const [own, other] = callLanguages()
    const mono = { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: theme.mutedForeground }
    const meanTotal = average(state.turns)
    return (
        <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: theme.card }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
                <Setting label={state.lang} onPress={() => void session.setLang(state.lang === own ? other : own)} />
                <Setting label={`Silence ${state.silenceMs} ms`} onPress={() => session.cycleSilence()} />
                <Setting label={`Voice ${state.voiceId}`} onPress={() => session.cycleVoice()} />
                <Setting label={`Sound ${state.waitSoundId}`} onPress={() => session.cycleWaitSound()} />
            </View>
            <AppText variant="caption" tone="muted" numberOfLines={2}>
                {model}
                {state.voiceId === 'iphone' && state.voice ? ` · ${state.voice}` : ''}
                {state.onDevice ? ' · on device' : ' · network'}
            </AppText>
            <ScrollView style={{ flexGrow: 0, maxHeight: 118 }}>
                <AppText style={mono}>{`turn  total | wait   hub chunk  text sentence audio${meanTotal === null ? '' : `   avg ${meanTotal}`}`}</AppText>
                {state.turns.slice(-SHOWN_TURNS).map(turn => (
                    <AppText key={turn.turn} style={[mono, { color: theme.foreground }]}>
                        {`#${String(turn.turn).padEnd(3)} ${ms(turn.totalMs).padStart(5)} | ${ms(turn.endpointMs).padStart(4)} ${ms(turn.acceptedMs).padStart(5)} ${ms(turn.firstChunkMs).padStart(5)} ${ms(turn.firstTextMs).padStart(5)} ${ms(turn.firstSentenceMs).padStart(8)} ${ms(turn.firstAudioMs).padStart(5)}`}
                    </AppText>
                ))}
            </ScrollView>
        </View>
    )
}

function CallView({ agentId }: { agentId: string }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const { state, session, name, model } = useCall(agentId)
    const [statsShown, setStatsShown] = useState(false)
    const interruptible = state.phase === 'thinking' || state.phase === 'speaking'
    const status = state.tool ? `Using ${state.tool}…` : STATUS[state.phase]
    const caption = state.phase === 'speaking' ? state.saying : state.heard

    const hangUp = () => {
        session.dispose()
        router.back()
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg, paddingHorizontal: spacing.lg + Math.max(insets.left, insets.right) }}>
            <StatusBar barStyle="light-content" />
            <View style={{ flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <GlassButton symbol="activity" label="Latency" scheme="dark" onPress={() => setStatsShown(shown => !shown)} />
                    {state.pickedUpAt === null ? null : <CallClock since={state.pickedUpAt} />}
                    <View style={{ width: 44 }} />
                </View>

                <Pressable onPress={() => session.interrupt()} disabled={!interruptible} accessibilityRole="button" accessibilityLabel="Interrupt" style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ flexShrink: 1, minHeight: AVATAR, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <CallAura session={session} phase={state.phase}>
                            <CoworkerAvatar coworker={{ id: agentId, kind: 'coworker', status: MOOD[state.phase] }} size={AVATAR} />
                        </CallAura>
                    </View>
                    <View style={{ alignItems: 'center', gap: spacing.xs }}>
                        <AppText variant="largeTitle" numberOfLines={1}>
                            {name}
                        </AppText>
                        <AppText variant="callout" tone={state.phase === 'blocked' ? 'destructive' : 'muted'} numberOfLines={1} style={{ minHeight: 20 }}>
                            {status}
                        </AppText>
                    </View>
                    <View style={{ width: '100%', minHeight: 112, justifyContent: 'center', paddingTop: spacing.lg }}>
                        <AppText variant="title" tone={state.phase === 'thinking' ? 'muted' : 'default'} numberOfLines={4} style={{ textAlign: 'center' }}>
                            {caption}
                        </AppText>
                        {state.error && (
                            <AppText variant="footnote" tone="destructive" numberOfLines={3} style={{ textAlign: 'center', paddingTop: spacing.sm }}>
                                {state.error}
                            </AppText>
                        )}
                    </View>
                </Pressable>

                {statsShown && <Stats state={state} session={session} model={model} />}

                <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg }}>
                    <AppText variant="caption" tone="muted" style={{ minHeight: 16 }}>
                        {interruptible ? 'Tap anywhere to interrupt' : ''}
                    </AppText>
                    <Pressable onPress={hangUp} accessibilityRole="button" accessibilityLabel="Hang up" style={{ width: HANG_UP, height: HANG_UP, borderRadius: HANG_UP / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.destructive }}>
                        <Icon name="phone" size={30} color="#ffffff" style={{ transform: [{ rotate: '135deg' }] }} />
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

// Proof of concept: every text of this screen is plain English on purpose, it never ships as is.
// The call is dark whatever the phone's appearance, the way a phone call is.
export function CallScreen({ agentId }: { agentId: string }) {
    return (
        <ThemeScope scheme="dark">
            <CallView agentId={agentId} />
        </ThemeScope>
    )
}
