import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CHAT_HEADER_HEIGHT, ChatHeader, type ChatTab } from '@/components/chat/ChatHeader'
import { activePageIndex, conversationPages } from '@/components/chat/conversation-pages'
import { ConversationPager } from '@/components/chat/ConversationPager'
import { coworkers, FOREMAN_ID } from '@/mocks/data'
import { ThemeScope, useColorSchemeName, useTheme } from '@/theme/theme'
import { spacing, type ColorScheme } from '@/theme/tokens'

import { MockPane, type LabState } from './lab-foreman'

// Dev only: a coworker's conversations with their tabs, over mock messages, swiped through as on a coworker.
//   /lab-chat?tabs=3&active=1&state=loading&coworker=foreman   tabs: how many are open; active: the index
//   on screen; state: what every open conversation shows, loading also leaving the tabs unnamed;
//   coworker: whose chat, Pulse when left out; probe=1: the keyboard heights the pane is lifted by;
//   scheme=dark|light: forces the theme, the system's when left out
const TITLES = ['Lyon agencies', 'LinkedIn post on pricing', 'Salutation amicale et prise de nouvelles', 'Q4 prospects', 'Weekly recap', 'Support triage']
const AUTOMATED_RUNS: ChatTab[] = [
    { id: 'lab-run-1', title: '4 applications sent: Doctolib, Qonto, Alan', running: false, empty: false, automationName: 'Daily missions apply', updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() },
    { id: 'lab-run-2', title: 'No new mission this morning', running: false, empty: false, automationName: 'Daily missions apply', updatedAt: new Date(Date.now() - 27 * 3_600_000).toISOString() },
]
const STATES: LabState[] = ['running', 'conversation', 'long', 'question', 'conversation', 'long']

export default function ChatLab() {
    const params = useLocalSearchParams<{ scheme?: ColorScheme }>()
    const system = useColorSchemeName()
    const scheme = params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : system
    return (
        <ThemeScope scheme={scheme}>
            <ChatLabScreen />
        </ThemeScope>
    )
}

function ChatLabScreen() {
    const params = useLocalSearchParams<{ tabs?: string; active?: string; state?: LabState; coworker?: string; probe?: string }>()
    const loading = params.state === 'loading'
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const tabs: ChatTab[] = TITLES.slice(0, Number(params.tabs ?? 3)).map((title, i) => ({ id: `lab-${i}`, title: loading ? null : title, running: i === 0 && !loading, empty: false, loading }))
    const [activeId, setActiveId] = useState<string | null>(tabs[Math.min(Number(params.active ?? 0), tabs.length - 1)]?.id ?? null)
    const coworker = coworkers.find(candidate => candidate.id === (params.coworker === FOREMAN_ID ? FOREMAN_ID : 'agent-pulse'))!
    const pages = conversationPages(
        tabs.map(tab => tab.id),
        {},
        'draft'
    )
    const activeIndex = activePageIndex(pages, activeId)
    const progress = useSharedValue(activeIndex)
    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <ConversationPager pages={pages} activeIndex={activeIndex} progress={progress} onSettle={index => setActiveId(pages[index]?.sessionId ?? null)} renderPage={page => <MockPane state={page.sessionId ? (params.state ?? STATES[pages.indexOf(page) % STATES.length]) : 'empty'} topInset={insets.top + CHAT_HEADER_HEIGHT + spacing.lg} seeThrough={false} coworkerName={coworker.name} probe={params.probe === '1'} />} />
            <ChatHeader coworker={coworker} tabs={tabs} activeId={activeId ?? undefined} progress={progress} allSessions={[...tabs, ...AUTOMATED_RUNS]} onBack={() => router.back()} onSelect={setActiveId} onNewSession={() => setActiveId(null)} onOpenDetails={() => router.push('/lab-coworker')} />
        </View>
    )
}
