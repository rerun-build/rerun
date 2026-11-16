import { useState } from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { brand, fonts } from '@/theme/tokens'

import { CALL_FAINT, CALL_INK, CALL_MUTED, CallButton, EndButton, LiveBars, LiveDot, phaseColor, SpokenLine, statusOf, useClock, type PrototypeProps } from './parts'

// Shop's Sol, Alta, pillowtalk: the screen is the conversation. The line being said fills it, word
// by word, and the one before it fades up and away. Nothing else competes with the words.
export function CaptionsCall({ call, agentId, name, top, onEnd }: PrototypeProps) {
    const insets = useSafeAreaInsets()
    const { height } = useWindowDimensions()
    const [muted, setMuted] = useState(false)
    const time = useClock(call.pickedUpAt)
    const color = phaseColor(call.phase, agentId)
    const previous = call.log.filter(entry => entry.kind === 'line').at(-1)
    const big = height < 720 ? 27 : 32

    return (
        <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
            <View style={{ flex: 1, paddingTop: top, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <AgentBuddy agentId={agentId} size={40} mood={call.phase === 'thinking' ? 'working' : 'idle'} facing="right" />
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.medium, fontSize: 16, color: CALL_INK }}>{name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <LiveDot color={color} />
                            <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: CALL_MUTED, fontVariant: ['tabular-nums'] }}>{time ? `${statusOf(call)} · ${time}` : 'Calling…'}</Text>
                        </View>
                    </View>
                </View>

                <Pressable onPress={call.interrupt} accessibilityLabel="Interrupt" style={{ flex: 1, minHeight: 0, justifyContent: 'center', overflow: 'hidden' }}>
                    {previous?.kind === 'line' && (
                        <Animated.Text key={`prev-${previous.line.text}`} entering={FadeIn.duration(400)} exiting={FadeOut.duration(200)} layout={LinearTransition} numberOfLines={2} style={{ fontFamily: fonts.medium, fontSize: 17, lineHeight: 23, color: CALL_FAINT, marginBottom: 20 }}>
                            {previous.line.text}
                        </Animated.Text>
                    )}
                    {call.line ? (
                        <Animated.View key={call.line.text} entering={FadeIn.duration(300)} layout={LinearTransition}>
                            <SpokenLine text={call.line.text} shown={call.shownWords} litColor={call.line.who === 'caller' ? brand.soft : CALL_INK} darkColor="rgba(250,250,250,0.14)" style={{ fontFamily: fonts.semibold, fontSize: big, lineHeight: big * 1.22, letterSpacing: -0.8 }} />
                        </Animated.View>
                    ) : (
                        <Animated.View key={statusOf(call)} entering={FadeIn.duration(300)} exiting={FadeOut.duration(150)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Text style={{ fontFamily: fonts.semibold, fontSize: big, lineHeight: big * 1.22, letterSpacing: -0.8, color: call.phase === 'thinking' ? color : CALL_MUTED }}>{statusOf(call)}</Text>
                        </Animated.View>
                    )}
                </Pressable>

                <LiveBars level={call.level} color={color} height={48} count={34} style={{ marginBottom: 24 }} />

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12 }}>
                    <CallButton icon="mic" label="Mute" active={muted} onPress={() => setMuted(value => !value)} />
                    <EndButton onPress={onEnd} size={72} />
                    <CallButton icon="message-circle" label="Open chat" />
                </View>
            </View>
        </View>
    )
}
