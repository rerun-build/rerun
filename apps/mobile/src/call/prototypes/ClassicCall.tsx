import { useState } from 'react'
import { Text, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { buddyColor, shade } from '@/components/buddy/look'
import { brand, fonts } from '@/theme/tokens'

import { CALL_FAINT, CALL_INK, CALL_MUTED, CallButton, EndButton, FadeSwap, Glow, PhaseGlow, SpokenLine, statusOf, useClock, useDrift, type PrototypeProps } from './parts'

// The iPhone's own call screen, FaceTime and WhatsApp: the coworker's colour floods the screen, its
// name sits big at the top and the buttons everyone knows sit in a grid at the bottom. Captions
// come as a bubble, on demand.
export function ClassicCall({ call, agentId, name, top, onEnd }: PrototypeProps) {
    const insets = useSafeAreaInsets()
    const { width, height } = useWindowDimensions()
    const [muted, setMuted] = useState(false)
    const [captions, setCaptions] = useState(true)
    const [held, setHeld] = useState(false)
    const time = useClock(call.pickedUpAt)
    const identity = buddyColor(agentId)
    const flood = Math.max(width, height) * 1.3
    const drift = useDrift(7000, width * 0.3)
    const short = height < 720
    const buddy = short ? 88 : 120
    const breathe = useAnimatedStyle(() => ({ transform: [{ scale: 1 + call.level.get() * 0.06 }] }))

    return (
        <View style={{ flex: 1, backgroundColor: shade(identity, -0.82), overflow: 'hidden' }}>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: (width - flood) / 2, top: -flood * 0.45, width: flood, height: flood }, drift]}>
                <Glow color={identity} size={flood} opacity={0.75} />
            </Animated.View>
            <Glow color={brand.base} size={flood * 0.8} opacity={0.35} style={{ left: -flood * 0.35, bottom: -flood * 0.45 }} />

            <View style={{ flex: 1, paddingTop: top + (short ? 8 : 28), paddingBottom: insets.bottom + 20, paddingHorizontal: 28, width: '100%', maxWidth: 520, alignSelf: 'center' }}>
                <View style={{ alignItems: 'center', gap: 6 }}>
                    <Animated.View style={[{ width: buddy * 1.5, height: buddy * 1.5, alignItems: 'center', justifyContent: 'center' }, breathe]}>
                        <PhaseGlow phase={call.phase} agentId={agentId} size={buddy * 1.5} />
                        <AgentBuddy agentId={agentId} size={buddy} mood={call.phase === 'thinking' ? 'working' : call.phase === 'ringing' ? 'waiting' : 'idle'} />
                    </Animated.View>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: short ? 30 : 36, letterSpacing: -0.8, color: CALL_INK }}>
                        {name}
                    </Text>
                    <FadeSwap swapKey={held ? 'held' : statusOf(call)}>
                        <Text style={{ fontFamily: fonts.regular, fontSize: 17, color: CALL_MUTED, fontVariant: ['tabular-nums'] }}>{held ? 'On hold' : time && call.phase !== 'thinking' ? `Rerun audio · ${time}` : statusOf(call)}</Text>
                    </FadeSwap>
                </View>

                <View style={{ flex: 1, minHeight: 0, justifyContent: 'center' }}>
                    {captions && call.line && (
                        <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={{ alignSelf: 'center', maxWidth: '100%', paddingHorizontal: 18, paddingVertical: 14, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                            <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: CALL_MUTED, marginBottom: 4 }}>{call.line.who === 'caller' ? 'You' : name}</Text>
                            <SpokenLine text={call.line.text} shown={call.shownWords} numberOfLines={4} litColor={CALL_INK} darkColor={CALL_FAINT} style={{ fontFamily: fonts.regular, fontSize: 17, lineHeight: 24 }} />
                        </Animated.View>
                    )}
                </View>

                <View style={{ gap: short ? 14 : 22 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <CallButton icon="mic" label="Mute" showLabel active={muted} onPress={() => setMuted(value => !value)} size={short ? 62 : 72} backdrop="rgba(255,255,255,0.16)" />
                        <CallButton icon={captions ? 'captions-fill' : 'captions'} label="Captions" showLabel active={captions} onPress={() => setCaptions(value => !value)} size={short ? 62 : 72} backdrop="rgba(255,255,255,0.16)" />
                        <CallButton icon="message-circle" label="Chat" showLabel size={short ? 62 : 72} backdrop="rgba(255,255,255,0.16)" />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <CallButton icon="pause-fill" label="Hold" showLabel active={held} onPress={() => setHeld(value => !value)} size={short ? 62 : 72} backdrop="rgba(255,255,255,0.16)" />
                        <CallButton icon="hand" label="Interrupt" showLabel onPress={call.interrupt} size={short ? 62 : 72} backdrop="rgba(255,255,255,0.16)" />
                        <EndButton onPress={onEnd} showLabel size={short ? 62 : 72} />
                    </View>
                </View>
            </View>
        </View>
    )
}
