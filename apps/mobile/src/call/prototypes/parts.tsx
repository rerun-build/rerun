import { useEffect, useId, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'

import { buddyColor } from '@/components/buddy/look'
import { Icon, type IconName } from '@/components/ui/Icon'
import { brand, fonts } from '@/theme/tokens'

import type { MockCall, MockPhase } from './mock-call'

export const CALL_INK = '#fafafa'
export const CALL_MUTED = 'rgba(250,250,250,0.55)'
export const CALL_FAINT = 'rgba(250,250,250,0.28)'
export const END_RED = '#ff3b30'
const THINKING_AMBER = '#f59e0b'
const RINGING_CYAN = '#22d3ee'

// The colour of the moment: cyan while it rings, the caller's violet while they talk, amber while the
// coworker works, and the coworker's own colour while it answers.
export function phaseColor(phase: MockPhase, agentId: string): string {
    if (phase === 'ringing') return RINGING_CYAN
    if (phase === 'listening') return brand.soft
    if (phase === 'thinking') return THINKING_AMBER
    return buddyColor(agentId)
}

export function statusOf(call: Pick<MockCall, 'phase' | 'tools'>): string {
    if (call.phase === 'ringing') return 'Calling…'
    if (call.phase === 'listening') return 'Listening'
    if (call.phase === 'thinking') return `${call.tools.at(-1)?.label ?? 'Thinking'}…`
    return 'Speaking'
}

function clock(elapsedMs: number): string {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function useClock(since: number | null): string | null {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(tick)
    }, [])
    return since === null ? null : clock(now - since)
}

// A soft disc of light, `color` at its heart and gone at its edge.
export function Glow({ color, size, opacity = 1, style }: { color: string; size: number; opacity?: number; style?: StyleProp<ViewStyle> }) {
    const id = useId().replace(/[^a-zA-Z0-9]/g, '')
    return (
        <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
            <Svg width="100%" height="100%">
                <Defs>
                    <RadialGradient id={id} cx="50%" cy="50%" r="50%">
                        <Stop offset="0" stopColor={color} stopOpacity={opacity} />
                        <Stop offset="0.45" stopColor={color} stopOpacity={opacity * 0.45} />
                        <Stop offset="1" stopColor={color} stopOpacity={0} />
                    </RadialGradient>
                </Defs>
                <Rect width="100%" height="100%" fill={`url(#${id})`} />
            </Svg>
        </View>
    )
}

// The same glow in every colour the call goes through, the one of the moment faded in over the others.
export function PhaseGlow({ phase, agentId, size, style }: { phase: MockPhase; agentId: string; size: number; style?: StyleProp<ViewStyle> }) {
    const phases: MockPhase[] = ['ringing', 'listening', 'thinking', 'speaking']
    return (
        <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
            {phases.map(each => (
                <FadingGlow key={each} shown={each === phase} color={phaseColor(each, agentId)} size={size} />
            ))}
        </View>
    )
}

function FadingGlow({ shown, color, size }: { shown: boolean; color: string; size: number }) {
    const opacity = useSharedValue(shown ? 1 : 0)
    useEffect(() => {
        opacity.set(withTiming(shown ? 1 : 0, { duration: 700, easing: Easing.inOut(Easing.quad) }))
    }, [shown, opacity])
    const style = useAnimatedStyle(() => ({ opacity: opacity.get() }))
    return (
        <Animated.View style={[StyleSheet.absoluteFill, style]}>
            <Glow color={color} size={size} />
        </Animated.View>
    )
}

// A slow wander, so a glow never sits still.
export function useDrift(duration: number, distance: number) {
    const drift = useSharedValue(0)
    useEffect(() => {
        drift.set(withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true))
    }, [drift, duration])
    return useAnimatedStyle(() => ({ transform: [{ translateX: (drift.get() - 0.5) * distance }, { translateY: (0.5 - drift.get()) * distance * 0.4 }] }))
}

// A line as it is said: the words already out are lit, the rest wait in the dark.
export function SpokenLine({ text, shown, style, litColor = CALL_INK, darkColor = 'rgba(250,250,250,0.18)', numberOfLines }: { text: string; shown: number; style?: StyleProp<TextStyle>; litColor?: string; darkColor?: string; numberOfLines?: number }) {
    const words = text.split(' ')
    return (
        <Text style={style} numberOfLines={numberOfLines}>
            <Text style={{ color: litColor }}>{words.slice(0, shown).join(' ')}</Text>
            <Text style={{ color: darkColor }}>{shown > 0 && shown < words.length ? ' ' : ''}{words.slice(shown).join(' ')}</Text>
        </Text>
    )
}

type CallButtonProps = { icon: IconName; label: string; onPress?: () => void; active?: boolean; size?: number; showLabel?: boolean; backdrop?: string }

// A round button of the call: frosted white at rest, solid white when switched on.
export function CallButton({ icon, label, onPress, active = false, size = 60, showLabel = false, backdrop = 'rgba(255,255,255,0.12)' }: CallButtonProps) {
    return (
        <View style={{ alignItems: 'center', gap: 6 }}>
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? CALL_INK : backdrop, opacity: pressed ? 0.7 : 1 })}>
                <Icon name={icon} size={Math.round(size * 0.4)} color={active ? '#0a0a0a' : CALL_INK} />
            </Pressable>
            {showLabel && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: CALL_MUTED }}>{label}</Text>}
        </View>
    )
}

export function EndButton({ onPress, size = 60, showLabel = false }: { onPress: () => void; size?: number; showLabel?: boolean }) {
    return (
        <View style={{ alignItems: 'center', gap: 6 }}>
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="End call" style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: END_RED, opacity: pressed ? 0.8 : 1 })}>
                <Icon name="phone" size={Math.round(size * 0.42)} color="#ffffff" style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
            {showLabel && <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: CALL_MUTED }}>End</Text>}
        </View>
    )
}

// The call's live bars: each one follows the loudness with a gain and a lag of its own.
export function LiveBars({ level, color, count = 28, height = 44, barWidth = 4, style }: { level: SharedValue<number>; color: string; count?: number; height?: number; barWidth?: number; style?: StyleProp<ViewStyle> }) {
    const [gains] = useState(() => Array.from({ length: count }, (_, index) => 0.35 + 0.65 * Math.abs(Math.sin(index * 1.7 + 0.4)) * (1 - Math.abs(index - count / 2) / count)))
    return (
        <View pointerEvents="none" style={[{ height, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: barWidth * 0.8 }, style]}>
            {gains.map((gain, index) => (
                <Bar key={index} level={level} gain={gain} height={height} width={barWidth} color={color} />
            ))}
        </View>
    )
}

function Bar({ level, gain, height, width, color }: { level: SharedValue<number>; gain: number; height: number; width: number; color: string }) {
    const style = useAnimatedStyle(() => ({ height: Math.max(width, height * level.get() * gain) }))
    return <Animated.View style={[{ width, borderRadius: width / 2, backgroundColor: color }, style]} />
}

export function LiveDot({ color }: { color: string }) {
    const pulse = useSharedValue(1)
    useEffect(() => {
        pulse.set(withRepeat(withTiming(0.3, { duration: 800 }), -1, true))
    }, [pulse])
    const style = useAnimatedStyle(() => ({ opacity: pulse.get() }))
    return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, style]} />
}

export function FadeSwap({ swapKey, children, style }: { swapKey: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
    return (
        <Animated.View key={swapKey} entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={style}>
            {children}
        </Animated.View>
    )
}

// What every prototype of the call screen is drawn from. `top` is where its content may start.
export type PrototypeProps = { call: MockCall; agentId: string; name: string; top: number; onEnd: () => void }
