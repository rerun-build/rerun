import { useState } from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { buddyColor } from '@/components/buddy/look'
import { brand, fonts } from '@/theme/tokens'

import type { MockPhase } from './mock-call'
import { CALL_FAINT, CALL_INK, CALL_MUTED, CallButton, EndButton, FadeSwap, Glow, PhaseGlow, SpokenLine, statusOf, useClock, useDrift, type PrototypeProps } from './parts'

const MOOD: Record<MockPhase, 'waiting' | 'idle' | 'working'> = { ringing: 'waiting', listening: 'idle', thinking: 'working', speaking: 'idle' }

// Google Live and Copilot: a field of light rises from the bottom of the screen and breathes with
// whoever talks. The coworker floats above it, the words of the moment under it.
export function AuroraCall({ call, agentId, name, top, onEnd }: PrototypeProps) {
    const insets = useSafeAreaInsets()
    const { width, height } = useWindowDimensions()
    const [muted, setMuted] = useState(false)
    const [captions, setCaptions] = useState(true)
    const time = useClock(call.pickedUpAt)
    const field = Math.max(width, height) * 1.1
    const buddy = Math.min(150, height * 0.18)

    const rise = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - call.level.get()) * field * 0.12 }, { scaleY: 0.8 + call.level.get() * 0.35 }] }))
    const left = useDrift(5200, width * 0.5)
    const right = useDrift(6800, -width * 0.45)

    return (
        <View style={{ flex: 1, backgroundColor: '#050507', overflow: 'hidden' }}>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: (width - field) / 2, bottom: -field * 0.62, width: field, height: field }, rise]}>
                <PhaseGlow phase={call.phase} agentId={agentId} size={field} />
                <Animated.View style={[{ position: 'absolute', left: -field * 0.15, top: field * 0.12, width: field * 0.7, height: field * 0.7 }, left]}>
                    <Glow color={buddyColor(agentId)} size={field * 0.7} opacity={0.55} />
                </Animated.View>
                <Animated.View style={[{ position: 'absolute', right: -field * 0.15, top: field * 0.16, width: field * 0.62, height: field * 0.62 }, right]}>
                    <Glow color={brand.base} size={field * 0.62} opacity={0.6} />
                </Animated.View>
            </Animated.View>

            <View style={{ flex: 1, paddingTop: top, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
                <View style={{ alignItems: 'center', gap: 2 }}>
                    <Text style={{ fontFamily: fonts.medium, fontSize: 17, color: CALL_INK }}>{name}</Text>
                    <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: CALL_MUTED, fontVariant: ['tabular-nums'] }}>{time ?? 'Calling…'}</Text>
                </View>

                <Pressable onPress={call.interrupt} accessibilityLabel="Interrupt" style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
                    <View style={{ width: buddy * 2, height: buddy * 2, alignItems: 'center', justifyContent: 'center' }}>
                        <PhaseGlow phase={call.phase} agentId={agentId} size={buddy * 2} />
                        <AgentBuddy agentId={agentId} size={buddy} mood={MOOD[call.phase]} />
                    </View>
                    <FadeSwap swapKey={statusOf(call)}>
                        <Text style={{ fontFamily: fonts.medium, fontSize: 15, color: CALL_MUTED }}>{statusOf(call)}</Text>
                    </FadeSwap>
                </Pressable>

                <View style={{ minHeight: 118, justifyContent: 'flex-end', paddingBottom: 24 }}>
                    {captions && call.line && (
                        <FadeSwap swapKey={call.line.text}>
                            <SpokenLine text={call.line.text} shown={call.shownWords} numberOfLines={4} litColor={call.line.who === 'caller' ? brand.soft : CALL_INK} darkColor={CALL_FAINT} style={{ fontFamily: fonts.medium, fontSize: 22, lineHeight: 29, letterSpacing: -0.3, textAlign: 'center' }} />
                        </FadeSwap>
                    )}
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28 }}>
                    <CallButton icon="mic" label="Mute" active={muted} onPress={() => setMuted(value => !value)} backdrop="rgba(255,255,255,0.14)" />
                    <EndButton onPress={onEnd} size={72} />
                    <CallButton icon={captions ? 'captions-fill' : 'captions'} label="Captions" active={captions} onPress={() => setCaptions(value => !value)} backdrop="rgba(255,255,255,0.14)" />
                </View>
            </View>
        </View>
    )
}
