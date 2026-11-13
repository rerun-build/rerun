import { appendVoiceMarker, buildVoiceMarker, FOREMAN_DISPLAY_NAME, teamEmptyStateOf } from '@rerun/contracts'
import type { UIMessage } from 'ai'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedReaction, useAnimatedStyle, type AnimatedKeyboardInfo, type DerivedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Composer } from '@/components/chat/Composer'
import { ConversationSkeleton } from '@/components/chat/ConversationSkeleton'
import { HitlBlock } from '@/components/chat/hitl/HitlBlock'
import { MessageView } from '@/components/chat/MessageView'
import { ForemanEmptyStateView } from '@/components/chat/EmptyStates'
import { RunStatus } from '@/components/chat/RunStatus'
import { Suggestions } from '@/components/chat/Suggestions'
import { useKeyboardShown } from '@/components/chat/useKeyboardShown'
import { CoworkerRow } from '@/components/home/CoworkerRow'
import { ForemanRow } from '@/components/home/ForemanRow'
import { HomeBottomBar } from '@/components/home/HomeBottomBar'
import { SectionHeader } from '@/components/home/SectionHeader'
import { EdgeFade } from '@/components/ui/EdgeFade'
import { ProgressiveBlur } from '@/components/ui/ProgressiveBlur'
import { statusLine } from '@/components/ui/status'
import { useKeyboardHeight } from '@/lib/keyboard-height'
import { coworkers, MOCK_VOICE_PEAKS, sessions } from '@/mocks/data'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

// Dev only: the Foreman's row on a Home of mock coworkers; a tap opens its chat in the given state.
//   /lab-foreman?state=conversation   state: loading | empty | conversation | long | running | streaming | question | approval
export type LabState = 'loading' | 'empty' | 'conversation' | 'long' | 'running' | 'streaming' | 'question' | 'approval'

const noop = () => {}
const FOREMAN = { id: 'foreman', kind: 'foreman' as const, name: FOREMAN_DISPLAY_NAME, role: 'Your Chief of Staff', status: 'idle' as const }

const text = (id: string, role: 'user' | 'assistant', body: string): UIMessage => ({ id, role, parts: [{ type: 'text', text: body }] })
const CONVERSATION: UIMessage[] = [
    text('u1', 'user', 'What is everyone working on?'),
    {
        id: 'a1',
        role: 'assistant',
        parts: [
            { type: 'tool-list_agents', toolCallId: 't1', state: 'output-available', input: {}, output: {} },
            { type: 'text', text: 'Three coworkers are running:\n\n- **Scout** is qualifying the Lyon agencies, 9 of 14 done.\n- **Pulse** is drafting the LinkedIn post on pricing.\n- **Ledger** waits on you: it needs the Stripe export before closing October.' },
        ],
    } as UIMessage,
    text('u2', 'user', appendVoiceMarker('Tell Ledger the export is in the shared folder', buildVoiceMarker({ src: 'chat-uploads/lab-voice.m4a', durationMs: 4_300, levels: MOCK_VOICE_PEAKS }))),
    text('a2', 'assistant', 'Done, I passed it on. Ledger picked it up and is closing October now.'),
]
const LONG: UIMessage[] = [...CONVERSATION.map(message => ({ ...message, id: `early-${message.id}` })), ...CONVERSATION]
const RUNNING: UIMessage[] = [...CONVERSATION, text('u3', 'user', 'Can you set up a coworker that posts a digest of new leads every morning?')]
const STREAMED = 'Sure. I will set up **Digest**, a coworker that reads the new leads every morning at 8 and posts a short summary.\n\nIt will list each lead with its company, where it came from and the next step, then flag the ones worth a call today.'
const SUGGESTIONS = ['Show me the leads', 'Make it weekly instead', 'Post it in Slack']
const QUESTION = { questions: [{ question: 'Where should the digest go?', options: ['Slack #sales', 'Email', 'Both'] }] }
const BEFORE_APPROVAL: UIMessage[] = [
    text('p1', 'user', 'Write a LinkedIn post on our new pricing and publish it this morning'),
    text('p2', 'assistant', 'Here is the draft:\n\n“Pricing should not need a calculator. From today, one plan, every feature, and you only pay for the seats you use.”\n\nIt is ready to go out on the Acme page.'),
]
const APPROVAL = { approvals: [{ action: 'Publish the post on LinkedIn', detail: 'page: Acme\nwhen: today, 9:00' }] }

const byId = (id: string) => coworkers.find(coworker => coworker.id === id)!
const latestOf = (id: string) => sessions.find(session => session.coworkerId === id)

function MockHome({ onForeman }: { onForeman: () => void }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 60, paddingBottom: insets.bottom + 120 }}>
                <View style={{ marginBottom: spacing.lg }}>
                    <ForemanRow last={{ title: 'Overnight catch-up', running: false }} onPress={onForeman} />
                </View>
                <SectionHeader label="Needs you" count={2} collapsed={false} onToggle={noop} />
                {['agent-scout', 'agent-ledger'].map(id => (
                    <CoworkerRow key={id} coworker={byId(id)} line={statusLine(byId(id), latestOf(id))} minutesAgo={byId(id).updatedMinutesAgo} unread={byId(id).unread} onPress={noop} />
                ))}
                <SectionHeader label="Working" count={3} collapsed={false} onToggle={noop} />
                {['agent-pulse', 'agent-inbox', 'agent-recap'].map(id => (
                    <CoworkerRow key={id} coworker={byId(id)} line={statusLine(byId(id), latestOf(id))} minutesAgo={byId(id).updatedMinutesAgo} unread={byId(id).unread} onPress={noop} />
                ))}
            </ScrollView>
            <EdgeFade edge="bottom" height={insets.bottom + 90} />
        </View>
    )
}

// A reply written a few words at a time, as the stream hands them over, then starting again.
function useStreamedReply(active: boolean) {
    const [length, setLength] = useState(0)
    useEffect(() => {
        if (!active) return
        const timer = setInterval(() => setLength(current => (current >= STREAMED.length + 40 ? 0 : current + 6 + Math.floor(Math.random() * 10))), 80)
        return () => clearInterval(timer)
    }, [active])
    return { text: STREAMED.slice(0, length), done: length >= STREAMED.length }
}

// RER-72, RER-68: the keyboard height Reanimated reads, the one the pane is lifted by, and the one React
// Native last heard of, to catch a lift that disagrees with the keyboard on screen.
function KeyboardProbe({ keyboard, lift }: { keyboard: AnimatedKeyboardInfo; lift: DerivedValue<number> }) {
    const [lifted, setLifted] = useState({ height: 0, state: 0, lift: 0 })
    const [heard, setHeard] = useState({ height: 0, visible: false })
    useAnimatedReaction(
        () => ({ height: Math.round(keyboard.height.value), state: keyboard.state.value, lift: Math.round(lift.value) }),
        (current, previous) => {
            if (current.height !== previous?.height || current.state !== previous?.state || current.lift !== previous?.lift) scheduleOnRN(setLifted, current)
        }
    )
    useEffect(() => {
        const shown = Keyboard.addListener('keyboardDidShow', event => setHeard({ height: Math.round(event.endCoordinates.height), visible: true }))
        const hidden = Keyboard.addListener('keyboardDidHide', () => setHeard({ height: 0, visible: false }))
        return () => {
            shown.remove()
            hidden.remove()
        }
    }, [])
    return (
        <View pointerEvents="none" testID="keyboard-probe" style={{ position: 'absolute', top: 120, right: 8, padding: 6, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.75)' }}>
            <Text style={{ color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'] }}>{`rea ${lifted.height} s${lifted.state}`}</Text>
            <Text style={{ color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'] }}>{`lift ${lifted.lift}`}</Text>
            <Text style={{ color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'] }}>{`rn ${heard.height} ${heard.visible ? 'up' : 'down'}`}</Text>
        </View>
    )
}

// The same layout as ConversationPane, fed by mock messages, lifted above the keyboard the same way.
export function MockPane({ state, topInset = spacing.lg, seeThrough = true, coworkerName = FOREMAN_DISPLAY_NAME, probe = false }: { state: LabState; topInset?: number; seeThrough?: boolean; coworkerName?: string; probe?: boolean }) {
    const insets = useSafeAreaInsets()
    const [draft, setDraft] = useState('')
    const [footerHeight, setFooterHeight] = useState(0)
    const scroll = useRef<ScrollViewInstance>(null)
    const streamed = useStreamedReply(state === 'streaming')
    const loading = state === 'loading'
    const messages = state === 'empty' || loading ? [] : state === 'approval' ? BEFORE_APPROVAL : state === 'conversation' ? CONVERSATION : state === 'long' ? LONG : state === 'streaming' ? [...RUNNING, ...(streamed.text ? [text('a3', 'assistant', streamed.text)] : [])] : RUNNING
    const running = state === 'running' || (state === 'streaming' && !streamed.done)
    const blockShown = state === 'question' || state === 'approval'
    const keyboard = useAnimatedKeyboard()
    const keyboardHeight = useKeyboardHeight()
    const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboardHeight.height.value + spacing.sm, insets.bottom) }))
    useKeyboardShown(() => scroll.current?.scrollToEnd({ animated: true }))
    return (
        <Animated.View style={[{ flex: 1 }, lift]}>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                <ScrollView ref={scroll} style={StyleSheet.absoluteFill} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ flexGrow: 1, justifyContent: messages.length || loading ? 'flex-end' : 'center', paddingTop: topInset, paddingBottom: footerHeight + 32, paddingHorizontal: spacing.xl - 4 }}>
                    {loading && <ConversationSkeleton />}
                    {messages.length === 0 && !loading && <ForemanEmptyStateView model={teamEmptyStateOf({ agents: coworkers.map(coworker => ({ id: coworker.id, name: coworker.name, handle: null, status: coworker.status, disabledAt: null })), nextRoutine: null, firstName: 'Clément' })} onSend={noop} onPrefill={noop} />}
                    {messages.length > 0 && (
                        <View style={{ gap: spacing.xl }}>
                            {messages.map((message, index) => (
                                <MessageView key={message.id} message={message} isLastAssistant={index === messages.length - 1} running={running} agentId={null} fileOwner={null} coworkerName={coworkerName} hiddenCallId={null} />
                            ))}
                            {state === 'question' && <HitlBlock pending={{ kind: 'question', toolCallId: 'lab-q', input: QUESTION, output: undefined }} agentId="foreman" coworkerName={FOREMAN_DISPLAY_NAME} webUrl="https://app.rerun.build" onAnswer={noop} onDismiss={noop} />}
                            {state === 'approval' && <HitlBlock pending={{ kind: 'approval', toolCallId: 'lab-a', input: APPROVAL, output: undefined }} agentId="agent-pulse" coworkerName={coworkerName} webUrl="https://app.rerun.build" onAnswer={noop} onDismiss={noop} />}
                            {running && <RunStatus coworker={FOREMAN} phase="working" />}
                        </View>
                    )}
                </ScrollView>
                <ProgressiveBlur height={footerHeight + 32} veiled={!seeThrough} />
                <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ gap: spacing.md, paddingTop: spacing.sm }}>
                    {(state === 'conversation' || state === 'long') && !draft && <Suggestions items={SUGGESTIONS} onPick={noop} />}
                    {!blockShown && (
                        <View style={{ paddingHorizontal: spacing.md }}>
                            <Composer value={draft} onChangeText={setDraft} onSend={noop} onStop={noop} running={running} placeholder={!messages.length ? 'What should we work on?' : seeThrough ? 'Ask your Chief of Staff anything' : `Message ${coworkerName}`} canAttach={!seeThrough} />
                        </View>
                    )}
                </View>
            </View>
            {probe && <KeyboardProbe keyboard={keyboard} lift={keyboardHeight.height} />}
        </Animated.View>
    )
}

export default function ForemanLab() {
    const insets = useSafeAreaInsets()
    const { state = 'conversation' } = useLocalSearchParams<{ state?: LabState }>()
    return (
        <View style={{ flex: 1 }}>
            <MockHome onForeman={() => router.push({ pathname: '/lab-chat', params: { coworker: 'foreman', tabs: '1', state } })} />
            <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.sm }}>
                <HomeBottomBar onSearch={noop} />
            </View>
        </View>
    )
}
