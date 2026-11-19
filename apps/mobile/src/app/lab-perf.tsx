import type { UIMessage } from 'ai'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CHAT_HEADER_HEIGHT } from '@/components/chat/ChatHeader'
import { Composer } from '@/components/chat/Composer'
import { Transcript } from '@/components/chat/Transcript'
import { useKeyboardHeight } from '@/lib/keyboard-height'
import { FrameMonitor } from '@/perf/FrameMonitor'
import { longTranscript, withStreamedReply } from '@/perf/long-transcript'
import { countRenders, stopCountingRenders, type RenderCounts } from '@/perf/renders'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// Dev only: a conversation of 200 messages drawn by the chat's own Transcript, to watch what
// typing, scrolling and a streamed reply cost. The corner shows the frames missed each second; a run
// prints how many times each piece redrew and how long the thread took to open.
//   /lab-perf?messages=200&run=type   messages: how long the thread is; run: type | stream | scroll, started on open
type Run = 'type' | 'stream' | 'scroll'

const TYPED = 'Can you send the recap to the whole team before noon?'
const RUN_MS = 4000

const noop = () => {}
const owner = { kind: 'agent' as const, agentId: 'lab-perf' }
const noRating = () => null
const unsigned = () => undefined
const noThreads = { leading: [], after: new Map() }
const noPaidSources = new Map()

function Thread({ messages, running }: { messages: UIMessage[]; running: boolean }) {
    return <Transcript messages={messages} busy={running} agentId="lab-perf" coworkerName="Pulse" fileOwner={owner} hiddenCallId={null} onStopTask={noop} ratingOf={noRating} onRate={noop} paidSourcesByTurn={noPaidSources} authorOf={unsigned} startedBy={null} threadRows={noThreads} onOpenThread={noop} />
}

export default function PerfLab() {
    const params = useLocalSearchParams<{ messages?: string; run?: Run }>()
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const [base] = useState(() => longTranscript(Number(params.messages ?? 200)))
    const [streamed, setStreamed] = useState(0)
    const [draft, setDraft] = useState('')
    const [footerHeight, setFooterHeight] = useState(0)
    const [report, setReport] = useState<string | null>(null)
    const [running, setRunning] = useState<Run | null>(null)
    const scroll = useRef<ScrollViewInstance>(null)
    const [mountedAt] = useState(() => performance.now())
    const opened = useRef(false)
    const keyboard = useKeyboardHeight()
    const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value + spacing.sm, insets.bottom) }))
    const messages = streamed > 0 ? withStreamedReply(base, streamed) : base

    const run = (kind: Run) => {
        const counts = countRenders()
        const startedAt = performance.now()
        setRunning(kind)
        setReport(null)
        let step = 0
        const timer = setInterval(() => {
            step += 1
            if (kind === 'type') setDraft(TYPED.slice(0, step % (TYPED.length + 1)))
            if (kind === 'stream') setStreamed(step * 18)
            if (kind === 'scroll') scroll.current?.scrollTo({ y: Math.max(0, 30_000 - step * 400), animated: true })
            if (performance.now() - startedAt < RUN_MS) return
            clearInterval(timer)
            const result: RenderCounts = counts()
            stopCountingRenders()
            setRunning(null)
            setReport(`${kind} · ${step} steps · ${Object.entries(result).map(([name, count]) => `${name} ${count}`).join(' · ')}`)
        }, kind === 'stream' ? 80 : 60)
    }

    const autoRun = params.run
    useEffect(() => {
        if (!autoRun) return
        const timer = setTimeout(() => run(autoRun), 1200)
        return () => clearTimeout(timer)
        // Once, when the lab opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <Animated.View style={[{ flex: 1, backgroundColor: theme.background }, lift]}>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                <ScrollView
                    ref={scroll}
                    style={StyleSheet.absoluteFill}
                    keyboardDismissMode="interactive"
                    scrollEventThrottle={64}
                    onContentSizeChange={() => {
                        if (opened.current) return
                        opened.current = true
                        scroll.current?.scrollToEnd({ animated: false })
                        setReport(`opened ${base.length} messages in ${Math.round(performance.now() - mountedAt)} ms`)
                    }}
                    contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: insets.top + CHAT_HEADER_HEIGHT + spacing.lg, paddingBottom: footerHeight + 32, paddingHorizontal: spacing.xl - 4 }}
                >
                    <View style={{ gap: spacing.xl }}>
                        <Thread messages={messages} running={running === 'stream'} />
                    </View>
                </ScrollView>
                <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ paddingTop: spacing.sm, paddingHorizontal: spacing.md }}>
                    <Composer value={draft} onChangeText={setDraft} onSend={noop} onStop={noop} running={running === 'stream'} placeholder="Message Pulse" canAttach={false} />
                </View>
            </View>
            <View style={{ position: 'absolute', top: insets.top + spacing.xs, left: spacing.md, right: 120, gap: spacing.xs }}>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    {(['type', 'stream', 'scroll'] as const).map(kind => (
                        <Pressable key={kind} disabled={running !== null} onPress={() => run(kind)} accessibilityRole="button" style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: running === kind ? '#4f46e5' : 'rgba(0,0,0,0.78)' }}>
                            <Text style={{ color: '#ffffff', fontSize: 12 }}>{kind}</Text>
                        </Pressable>
                    ))}
                </View>
                {report && (
                    <Text testID="perf-report" style={{ color: '#ffffff', fontSize: 11, backgroundColor: 'rgba(0,0,0,0.78)', padding: 6, borderRadius: 8, fontVariant: ['tabular-nums'] }}>
                        {report}
                    </Text>
                )}
            </View>
            <FrameMonitor top={insets.top + spacing.xs} />
        </Animated.View>
    )
}
