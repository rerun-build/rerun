import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, { Easing, FadeIn, FadeInDown, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { Icon, type IconName } from '@/components/ui/Icon'
import { brand, fonts, withAlpha } from '@/theme/tokens'

import type { MockEntry, MockTool } from './mock-call'
import { CALL_INK, CALL_MUTED, CallButton, EndButton, LiveBars, LiveDot, phaseColor, SpokenLine, statusOf, useClock, type PrototypeProps } from './parts'

const BACKGROUND = '#0a0a0a'
const SHOWN_ENTRIES = 8
const TOOL_ICONS: [RegExp, IconName][] = [
    [/search/i, 'search'],
    [/email|mail/i, 'mail'],
    [/calendar/i, 'calendar'],
    [/draft|writ/i, 'pencil'],
]

function toolIcon(label: string): IconName {
    return TOOL_ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? 'zap'
}

// Google Live's sources and Truecaller's live transcript: the call reads like the chat it really
// is. The caller's words land on the right, the coworker's on the left, and between them, live,
// each thing the coworker does to answer, so a silence is never empty.
export function WorkbenchCall({ call, agentId, name, top, onEnd }: PrototypeProps) {
    const insets = useSafeAreaInsets()
    const [muted, setMuted] = useState(false)
    const time = useClock(call.pickedUpAt)
    const color = phaseColor(call.phase, agentId)
    const pending = call.tools.filter(tool => !tool.done)

    return (
        <View style={{ flex: 1, backgroundColor: BACKGROUND }}>
            <View style={{ flex: 1, paddingTop: top, paddingBottom: insets.bottom + 16, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 }}>
                    <AgentBuddy agentId={agentId} size={44} mood={call.phase === 'thinking' ? 'working' : call.phase === 'ringing' ? 'waiting' : 'idle'} facing="right" />
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.medium, fontSize: 16, color: CALL_INK }}>{name}</Text>
                        <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: CALL_MUTED, fontVariant: ['tabular-nums'] }}>{time ? `On call · ${time}` : 'Calling…'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: withAlpha(color, 0.14) }}>
                        <LiveDot color={color} />
                        <Text style={{ fontFamily: fonts.medium, fontSize: 12, color }}>{call.phase === 'thinking' ? 'Working' : statusOf(call)}</Text>
                    </View>
                </View>

                <Pressable onPress={call.interrupt} accessibilityLabel="Interrupt" style={{ flex: 1, minHeight: 0, justifyContent: 'flex-end', overflow: 'hidden', paddingHorizontal: 20 }}>
                    <View style={{ gap: 14 }}>
                        {call.log.slice(-SHOWN_ENTRIES).map((entry, index) => (
                            <Entry key={`${Math.max(0, call.log.length - SHOWN_ENTRIES) + index}-${entryKey(entry)}`} entry={entry} />
                        ))}
                        {pending.map(tool => (
                            <ToolRow key={`pending-${tool.label}`} tool={tool} />
                        ))}
                        {call.line && (
                            <Animated.View key={`live-${call.line.text}`} entering={FadeIn.duration(250)} layout={LinearTransition} style={call.line.who === 'caller' ? callerBubble : undefined}>
                                <SpokenLine text={call.line.text} shown={call.shownWords} litColor={CALL_INK} darkColor="rgba(250,250,250,0.22)" style={call.line.who === 'caller' ? callerText : coworkerText} />
                            </Animated.View>
                        )}
                    </View>
                    <TopFade />
                </Pressable>

                <LiveBars level={call.level} color={color} height={28} count={40} barWidth={3} style={{ marginVertical: 16 }} />

                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28 }}>
                    <CallButton icon="mic" label="Mute" active={muted} onPress={() => setMuted(value => !value)} />
                    <EndButton onPress={onEnd} size={72} />
                    <CallButton icon="message-circle" label="Type instead" />
                </View>
            </View>
        </View>
    )
}

const callerBubble = { alignSelf: 'flex-end' as const, maxWidth: '82%' as const, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderBottomRightRadius: 6, backgroundColor: withAlpha(brand.base, 0.55) }
const callerText = { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: CALL_INK }
const coworkerText = { fontFamily: fonts.medium, fontSize: 19, lineHeight: 26, letterSpacing: -0.3, color: CALL_INK }

function entryKey(entry: MockEntry): string {
    return entry.kind === 'line' ? entry.line.text : entry.tool.label
}

function Entry({ entry }: { entry: MockEntry }) {
    if (entry.kind === 'tool') return <ToolRow tool={entry.tool} />
    const caller = entry.line.who === 'caller'
    return (
        <Animated.View layout={LinearTransition} style={caller ? callerBubble : undefined}>
            <Text style={[caller ? callerText : coworkerText, !caller && { color: 'rgba(250,250,250,0.6)' }]}>{entry.line.text}</Text>
        </Animated.View>
    )
}

function ToolRow({ tool }: { tool: MockTool }) {
    return (
        <Animated.View entering={FadeInDown.duration(300)} layout={LinearTransition} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', paddingLeft: 10, paddingRight: 14, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Icon name={toolIcon(tool.label)} size={15} color={CALL_MUTED} />
            <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 13, color: tool.done ? CALL_MUTED : CALL_INK, flexShrink: 1 }}>
                {tool.label}
                <Text style={{ fontFamily: fonts.regular, color: 'rgba(250,250,250,0.4)' }}>{`  ${tool.detail}`}</Text>
            </Text>
            {tool.done ? <Icon name="check" size={14} color="#4ade80" /> : <Spinner />}
        </Animated.View>
    )
}

function Spinner() {
    const turn = useSharedValue(0)
    useEffect(() => {
        turn.set(withRepeat(withTiming(1, { duration: 800, easing: Easing.linear }), -1))
    }, [turn])
    const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }))
    return <Animated.View style={[{ width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(250,250,250,0.2)', borderTopColor: '#f59e0b' }, style]} />
}

function TopFade() {
    return (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 80 }}>
            <Svg width="100%" height="100%">
                <Defs>
                    <LinearGradient id="workbench-fade" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={BACKGROUND} stopOpacity={1} />
                        <Stop offset="1" stopColor={BACKGROUND} stopOpacity={0} />
                    </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#workbench-fade)" />
            </Svg>
        </View>
    )
}
