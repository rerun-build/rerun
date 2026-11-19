import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { UIMessage } from 'ai'
import { Platform } from 'react-native'

import { ConversationPane } from '@/components/chat/ConversationPane'

import { longTranscript, withStreamedReply } from './long-transcript'
import { countRenders, stopCountingRenders, type RenderCounts } from './renders'

// What a conversation of 200 messages redraws while someone types, scrolls, or reads a reply arrive.
// Typing and scrolling redraw no message; a streamed reply redraws the message it writes and no other.

type MockChatState = { messages: UIMessage[]; busy: boolean; status: string }

const mockChat = {
    state: { messages: [], busy: false, status: 'ready' } as MockChatState,
    set: (_next: MockChatState) => {},
}

jest.mock('@/chat/useCoworkerChat', () => {
    const { useState } = jest.requireActual<typeof import('react')>('react')
    const stable = { regenerate: async () => {}, activeRunId: () => null, send: async () => {}, stop: async () => {}, retry: () => {} }
    return {
        useCoworkerChat: () => {
            const [state, setState] = useState(mockChat.state)
            mockChat.set = setState
            return { ...stable, ...state, runStartedAt: 0, error: undefined, sessionId: 'perf-session', history: 'ready', fresh: true }
        },
    }
})
jest.mock('@/auth/AuthProvider', () => {
    const auth = { session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }
    return { useAuth: () => auth }
})
jest.mock('@/chat/useQueuedMessage', () => {
    const queue = { queued: null, restoredId: null, enqueue: () => {}, clear: () => {} }
    return { useQueuedMessage: () => queue }
})
jest.mock('@/chat/useSkillProposals', () => {
    const proposals = { proposals: new Map(), pinned: [], pinnedIds: new Set(), pendingId: null, decide: async () => {} }
    return { useSkillProposals: () => proposals }
})
jest.mock('@/chat/useMessageFeedback', () => {
    const feedback = { ratingOf: () => null, rate: async () => {} }
    return { useMessageFeedback: () => feedback }
})
jest.mock('@/data/useMemberProfiles', () => {
    const profileOf = () => undefined
    return { useMemberProfiles: () => profileOf }
})
jest.mock('@/data/useCoworkerSkills', () => {
    const skills: unknown[] = []
    return { useCoworkerSkills: () => skills }
})
jest.mock('@/data/useMentionComputers', () => {
    const computers: unknown[] = []
    return { useMentionComputers: () => computers }
})
jest.mock('@/data/useWorkspaceAgents', () => ({ useWorkspaceAgents: () => null }))
jest.mock('@/data/local-cache', () => ({ cachedBoard: () => ({ read: () => null }) }))
jest.mock('@/components/chat/screen/useAgentScreen', () => {
    const screen = { status: 'idle', uri: null, attachWebView: () => {}, onMessage: () => {}, frames: null, mirror: () => {} }
    return { useAgentScreen: () => screen }
})
jest.mock('@/components/chat/screen/useTakeoverRequest', () => ({ useTakeoverRequest: () => undefined }))
jest.mock('@/notifications/push', () => ({ askForPushOnce: async () => {}, setConversationOnScreen: () => {} }))
jest.mock('@/api/uploads', () => ({}))
jest.mock('@/lib/analytics', () => ({ track: () => {} }))
jest.mock('expo-router', () => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react')
    return { router: { push: jest.fn() }, useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) }
})
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-svg', () => {
    const Shape = () => null
    return { __esModule: true, default: Shape, Svg: Shape, Path: Shape, G: Shape, Circle: Shape, Rect: Shape, Defs: Shape, LinearGradient: Shape, RadialGradient: Shape, Stop: Shape, Polygon: Shape, Ellipse: Shape, Line: Shape, ClipPath: Shape, Mask: Shape }
})

const coworker = { id: 'agent-perf', kind: 'coworker' as const, name: 'Pulse', role: '', status: 'idle' as const }
const endpoints = { agentId: 'agent-perf', sendPath: '/api/chat', sendBody: () => ({}), bornSessionOf: () => null, messages: async () => [], activeRun: async () => null, stop: async () => {}, fileOwner: () => ({ kind: 'agent' as const, agentId: 'agent-perf' }) }
const makeEndpoints = () => endpoints
const noop = () => {}

async function openLongConversation(messages = longTranscript()) {
    mockChat.state = { messages, busy: false, status: 'ready' }
    await render(<ConversationPane coworker={coworker} makeEndpoints={makeEndpoints} initialSessionId="perf-session" onSessionCreated={noop} models={null} status="idle" onStatusChange={noop} webUrl="https://app.rerun.build" />)
    await act(async () => {})
}

async function measure(label: string, action: () => Promise<void>): Promise<RenderCounts> {
    const counts = countRenders()
    const startedAt = performance.now()
    await action()
    const result = counts()
    stopCountingRenders()
    console.log(`${label} in ${Math.round(performance.now() - startedAt)} ms`, result)
    return result
}

const describeOnIos = Platform.OS === 'ios' ? describe : describe.skip

describeOnIos('a conversation of 200 messages', () => {
    afterEach(stopCountingRenders)

    it('opens on its last messages, the earlier ones drawn as the thread is scrolled up to them', async () => {
        const counts = await measure('opening 200 messages', () => openLongConversation())
        expect(counts.MessageView ?? 0).toBeLessThanOrEqual(40)
    })

    it('redraws its messages within budget while someone types', async () => {
        await openLongConversation()
        const input = screen.getByTestId('composer-input')
        const counts = await measure('typing 10 characters', async () => {
            for (const draft of ['H', 'He', 'Hel', 'Hell', 'Hello', 'Hello ', 'Hello t', 'Hello th', 'Hello the', 'Hello there']) await fireEvent.changeText(input, draft)
        })
        expect(counts.MessageView ?? 0).toBe(0)
        expect(counts.Markdown ?? 0).toBe(0)
    })

    it('redraws its messages within budget while the thread scrolls', async () => {
        await openLongConversation()
        const thread = screen.getByTestId('conversation-thread')
        const counts = await measure('scrolling 10 events', async () => {
            for (let step = 1; step <= 10; step++) await fireEvent.scroll(thread, { nativeEvent: { contentOffset: { x: 0, y: 4000 - step * 120 }, contentSize: { width: 390, height: 20_000 }, layoutMeasurement: { width: 390, height: 844 } } })
        })
        expect(counts.MessageView ?? 0).toBe(0)
        expect(counts.Markdown ?? 0).toBe(0)
        expect(counts.ConversationPane ?? 0).toBeLessThanOrEqual(1)
    })

    it('redraws its messages within budget while a reply streams in', async () => {
        const messages = longTranscript()
        await openLongConversation(messages)
        const counts = await measure('streaming 10 chunks', async () => {
            for (let chunk = 1; chunk <= 10; chunk++) await act(async () => mockChat.set({ messages: withStreamedReply(messages, chunk * 24), busy: true, status: 'streaming' }))
        })
        // The first chunk adds the reply and wakes the answer before it, whose buttons wait for the run.
        expect(counts.MessageView ?? 0).toBeLessThanOrEqual(12)
        expect(counts.Markdown ?? 0).toBeLessThanOrEqual(20)
    })
})
