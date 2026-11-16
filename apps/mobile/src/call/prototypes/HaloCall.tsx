import { useEffect, useId, useState } from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useFrameCallback, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { buddyColor } from '@/components/buddy/look'
import { brand, fonts } from '@/theme/tokens'

import type { MockPhase } from './mock-call'
import { CALL_FAINT, CALL_INK, CALL_MUTED, CallButton, EndButton, FadeSwap, PhaseGlow, SpokenLine, statusOf, useClock, type PrototypeProps } from './parts'

// Turns per second of the ring: it idles while the call talks and races while the coworker works.
const SPIN: Record<MockPhase, number> = { ringing: 0.12, listening: 0.08, thinking: 0.9, speaking: 0.14 }
const STROKE = 7
const RIPPLES = [0, 1, 2]
const RIPPLE_MS = 2400

// WhatsApp's Meta AI and ChatGPT's voice mode: one luminous ring holds the coworker. It swells with
// the voice, spins up and breaks into dashes while the coworker works, and sends ripples while it rings.
export function HaloCall({ call, agentId, name, top, onEnd }: PrototypeProps) {
    const insets = useSafeAreaInsets()
    const { width, height } = useWindowDimensions()
    const [muted, setMuted] = useState(false)
    const time = useClock(call.pickedUpAt)
    const ring = Math.min(width * 0.68, height * 0.34, 300)

    return (
        <View style={{ flex: 1, backgroundColor: '#050505' }}>
            <View style={{ flex: 1, paddingTop: top, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
                <Pressable onPress={call.interrupt} accessibilityLabel="Interrupt" style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: ring * 1.6, height: ring * 1.6, alignItems: 'center', justifyContent: 'center' }}>
                        <PhaseGlow phase={call.phase} agentId={agentId} size={ring * 1.6} />
                        {call.phase === 'ringing' && RIPPLES.map(index => <Ripple key={index} size={ring} delay={(index * RIPPLE_MS) / RIPPLES.length} color={buddyColor(agentId)} />)}
                        <Ring size={ring} phase={call.phase} level={call.level} agentId={agentId} />
                        <AgentBuddy agentId={agentId} size={ring * 0.46} mood={call.phase === 'thinking' ? 'working' : call.phase === 'ringing' ? 'waiting' : 'idle'} />
                    </View>
                    <View style={{ alignItems: 'center', gap: 4, marginTop: 8 }}>
                        <Text style={{ fontFamily: fonts.semibold, fontSize: 28, letterSpacing: -0.6, color: CALL_INK }}>{name}</Text>
                        <FadeSwap swapKey={statusOf(call)}>
                            <Text style={{ fontFamily: fonts.regular, fontSize: 15, color: CALL_MUTED, fontVariant: ['tabular-nums'] }}>{time && call.phase !== 'thinking' ? `${statusOf(call)} · ${time}` : statusOf(call)}</Text>
                        </FadeSwap>
                    </View>
                </Pressable>

                <View style={{ minHeight: 84, justifyContent: 'center', paddingBottom: 20 }}>
                    {call.line && (
                        <FadeSwap swapKey={call.line.text}>
                            <SpokenLine text={call.line.text} shown={call.shownWords} numberOfLines={3} litColor={call.line.who === 'caller' ? brand.soft : CALL_INK} darkColor={CALL_FAINT} style={{ fontFamily: fonts.regular, fontSize: 17, lineHeight: 24, textAlign: 'center' }} />
                        </FadeSwap>
                    )}
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28 }}>
                    <CallButton icon="mic" label="Mute" active={muted} onPress={() => setMuted(value => !value)} />
                    <EndButton onPress={onEnd} size={72} />
                    <CallButton icon="hand" label="Interrupt" onPress={call.interrupt} />
                </View>
            </View>
        </View>
    )
}

function Ring({ size, phase, level, agentId }: { size: number; phase: MockPhase; level: SharedValue<number>; agentId: string }) {
    const id = useId().replace(/[^a-zA-Z0-9]/g, '')
    const angle = useSharedValue(0)
    const speed = useSharedValue(SPIN[phase])
    useEffect(() => {
        speed.set(withTiming(SPIN[phase], { duration: 600 }))
    }, [phase, speed])
    useFrameCallback(frame => {
        angle.set((angle.get() + (speed.get() * 360 * (frame.timeSincePreviousFrame ?? 16)) / 1000) % 360)
    })
    const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }, { scale: 1 + level.get() * 0.09 }] }))
    const radius = size / 2 - STROKE
    const dashed = phase === 'thinking'
    return (
        <Animated.View style={[{ position: 'absolute', width: size, height: size }, style]}>
            <Svg width={size} height={size}>
                <Defs>
                    <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0" stopColor={buddyColor(agentId)} />
                        <Stop offset="0.5" stopColor={brand.soft} />
                        <Stop offset="1" stopColor="#22d3ee" />
                    </LinearGradient>
                </Defs>
                <Circle cx={size / 2} cy={size / 2} r={radius} stroke={`url(#${id})`} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeDasharray={dashed ? [radius * 0.5, radius * 0.32] : undefined} />
                <Circle cx={size / 2} cy={size / 2} r={radius - STROKE * 2} stroke={`url(#${id})`} strokeWidth={1} strokeOpacity={0.35} fill="none" />
            </Svg>
        </Animated.View>
    )
}

function Ripple({ size, delay, color }: { size: number; delay: number; color: string }) {
    const progress = useSharedValue(0)
    useEffect(() => {
        const start = setTimeout(() => progress.set(withRepeat(withTiming(1, { duration: RIPPLE_MS, easing: Easing.out(Easing.quad) }), -1)), delay)
        return () => clearTimeout(start)
    }, [progress, delay])
    const style = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - progress.get()), transform: [{ scale: 1 + progress.get() * 0.55 }] }))
    return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, style]} />
}
