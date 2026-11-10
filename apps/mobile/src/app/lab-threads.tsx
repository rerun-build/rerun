import { threadsByMessage } from '@rerun/contracts'
import { router, useLocalSearchParams } from 'expo-router'
import { Fragment, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useMessageTimes } from '@/chat/useMessageTimes'
import { CHAT_HEADER_HEIGHT, ChatHeader, type ChatTab } from '@/components/chat/ChatHeader'
import { Composer } from '@/components/chat/Composer'
import { activePageIndex, conversationPages } from '@/components/chat/conversation-pages'
import { ConversationPager } from '@/components/chat/ConversationPager'
import { MessageView } from '@/components/chat/MessageView'
import type { ThreadItem } from '@/components/chat/threads/general-threads'
import { ThreadBranch } from '@/components/chat/threads/ThreadBranch'
import { TimedTurns } from '@/components/chat/TimedTurns'
import { CHAT_COLUMN_MAX_WIDTH } from '@/components/layout/split'
import { ProgressiveBlur } from '@/components/ui/ProgressiveBlur'
import { coworkers } from '@/mocks/data'
import { GENERAL_MESSAGES, GENERAL_THREADS } from '@/mocks/threads'
import { ThemeScope, useTheme } from '@/theme/theme'
import { spacing, type ColorScheme } from '@/theme/tokens'

import { MockPane, type LabState } from './lab-foreman'

// Dev only: a coworker's General with its threads hanging between the messages, General pinned first
// in the header and the pager, the open threads after it. A tap on a thread slides to it.
//   /lab-threads?scheme=dark&general=empty&threads=none
//   general=empty: General has no message yet, its threads lead. threads=none: General alone, no thread yet.
const GENERAL_ID = 'lab-general'
const THREAD_STATES: Record<string, LabState> = { 'th-week': 'running', 'th-approval': 'approval' }

function GeneralPane({ empty, threads, coworkerName, topInset, onOpenThread }: { empty: boolean; threads: ThreadItem[]; coworkerName: string; topInset: number; onOpenThread: (thread: ThreadItem) => void }) {
    const insets = useSafeAreaInsets()
    const [draft, setDraft] = useState('')
    const [footerHeight, setFooterHeight] = useState(0)
    const scroll = useRef<ScrollViewInstance>(null)
    const messages = empty ? [] : GENERAL_MESSAGES
    const { leading, after } = threadsByMessage(useMessageTimes(messages), threads)
    const branch = (thread: ThreadItem) => <ThreadBranch key={thread.id} thread={thread} onOpen={() => onOpenThread(thread)} />
    return (
        <View style={{ flex: 1, paddingBottom: insets.bottom, justifyContent: 'flex-end' }}>
            <ScrollView ref={scroll} style={StyleSheet.absoluteFill} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: topInset, paddingBottom: footerHeight + insets.bottom + 32, paddingHorizontal: spacing.xl - 4 }}>
                <View style={{ gap: spacing.xl, width: '100%', maxWidth: CHAT_COLUMN_MAX_WIDTH, alignSelf: 'center' }}>
                    {leading.map(branch)}
                    <TimedTurns
                        messages={messages}
                        authorOf={() => undefined}
                        renderMessage={(item, index, stamp) => (
                            <Fragment key={item.id}>
                                <MessageView message={item} isLastAssistant={false} running={false} agentId="agent-pulse" fileOwner={null} coworkerName={coworkerName} hiddenCallId={null} stamp={stamp} />
                                {after.get(index)?.map(branch)}
                            </Fragment>
                        )}
                    />
                </View>
            </ScrollView>
            <ProgressiveBlur height={footerHeight + insets.bottom + 32} veiled={false} />
            <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={{ paddingTop: spacing.sm, paddingHorizontal: spacing.md, width: '100%', maxWidth: CHAT_COLUMN_MAX_WIDTH + 2 * spacing.md, alignSelf: 'center' }}>
                <Composer value={draft} onChangeText={setDraft} onSend={() => {}} onStop={() => {}} running={false} placeholder={`Message ${coworkerName}`} />
            </View>
        </View>
    )
}

function ThreadsLab({ empty, threads }: { empty: boolean; threads: ThreadItem[] }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const coworker = coworkers.find(candidate => candidate.id === 'agent-pulse')!
    const threadById = new Map(threads.map(thread => [thread.id, thread]))
    const [openIds, setOpenIds] = useState(['th-week', 'th-approval'].filter(id => threadById.has(id)))
    const [activeId, setActiveId] = useState<string | null>(GENERAL_ID)
    const tabOf = (thread: ThreadItem): ChatTab => ({ id: thread.id, title: thread.title, running: thread.status === 'working', empty: false, status: thread.status, automationName: thread.automationName, updatedAt: thread.createdAt, kind: 'thread' })
    const general: ChatTab = { id: GENERAL_ID, title: 'General', running: false, empty, kind: 'general' }
    const tabs = [general, ...openIds.map(id => tabOf(threadById.get(id)!))]
    const pages = conversationPages(
        tabs.map(tab => tab.id),
        {},
        'draft'
    )
    const activeIndex = activePageIndex(pages, activeId)
    const progress = useSharedValue(activeIndex)
    const topInset = insets.top + CHAT_HEADER_HEIGHT + spacing.lg
    const openThread = (thread: ThreadItem) => {
        setOpenIds(current => (current.includes(thread.id) ? current : [...current, thread.id]))
        setActiveId(thread.id)
    }
    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <ConversationPager
                pages={pages}
                activeIndex={activeIndex}
                progress={progress}
                onSettle={index => setActiveId(pages[index]?.sessionId ?? null)}
                renderPage={page => (page.sessionId === GENERAL_ID ? <GeneralPane empty={empty} threads={threads} coworkerName={coworker.name} topInset={topInset} onOpenThread={openThread} /> : <MockPane state={page.sessionId ? (THREAD_STATES[page.sessionId] ?? 'conversation') : 'empty'} topInset={topInset} seeThrough={false} coworkerName={coworker.name} />)}
            />
            <ChatHeader coworker={coworker} tabs={tabs} activeId={activeId ?? undefined} progress={progress} allSessions={[general, ...threads.map(tabOf)]} onBack={() => router.back()} onSelect={id => (threadById.has(id) ? openThread(threadById.get(id)!) : setActiveId(id))} onNewSession={() => setActiveId(null)} onOpenDetails={() => router.push('/lab-coworker')} />
        </View>
    )
}

export default function LabThreads() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme; general?: string; threads?: string }>()
    const scheme: ColorScheme = params.scheme === 'dark' ? 'dark' : 'light'
    return (
        <ThemeScope scheme={scheme}>
            <ThreadsLab key={params.threads ?? 'all'} empty={params.general === 'empty'} threads={params.threads === 'none' ? [] : GENERAL_THREADS} />
        </ThemeScope>
    )
}
