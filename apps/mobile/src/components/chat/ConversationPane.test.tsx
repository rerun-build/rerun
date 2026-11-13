import { fireEvent, render, screen } from '@testing-library/react-native'
import type { UIMessage } from 'ai'

import { coworkerEndpoints } from '@/chat/endpoints'

import { BLUR_ABOVE_FOOTER, ConversationPane } from './ConversationPane'

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-reanimated', () => ({ ...jest.requireActual('react-native-reanimated/mock'), useReducedMotion: () => false, useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }) }))
jest.mock('expo-router', () => {
    const { useEffect } = jest.requireActual('react')
    return { router: { push: jest.fn() }, useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) }
})
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: null, me: null }) }))
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }))
jest.mock('@/notifications/push', () => ({ askForPushOnce: jest.fn(async () => {}), setConversationOnScreen: jest.fn() }))
jest.mock('@/components/ui/EdgeFade', () => {
    const React = require('react')
    const { View } = require('react-native')
    return { EdgeFade: ({ edge, height, solid }: { edge: string; height: number; solid?: number }) => React.createElement(View, { testID: `edge-fade:${edge}:${height}:${solid}` }) }
})
// The composer and the chips host SwiftUI, which Jest cannot mount; the transcript's bubbles pull the
// markdown engine. The pane's own layout is what is under test.
jest.mock('./Composer', () => {
    const React = require('react')
    const { View } = require('react-native')
    return { Composer: () => React.createElement(View, { testID: 'composer' }) }
})
jest.mock('./Suggestions', () => {
    const React = require('react')
    const { Text, View } = require('react-native')
    return { Suggestions: ({ items }: { items: string[] }) => React.createElement(View, { testID: 'suggestions' }, items.map(item => React.createElement(Text, { key: item }, item))) }
})
jest.mock('./MessageView', () => {
    const React = require('react')
    const { View } = require('react-native')
    return { MessageView: () => React.createElement(View, { testID: 'message' }) }
})
jest.mock('@/chat/useCoworkerChat', () => ({ useCoworkerChat: () => mockChat }))

const MESSAGES = [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Find me three leads' }] },
    {
        id: 'm2',
        role: 'assistant',
        parts: [
            { type: 'text', text: 'Here are three leads in Lyon.' },
            { type: 'tool-suggest_replies', toolCallId: 'call-1', state: 'output-available', input: { replies: ['Show me more', 'Stop here'] }, output: { ok: true } },
        ],
    },
] as unknown as UIMessage[]

const mockChat = {
    messages: MESSAGES,
    status: 'ready' as const,
    runStartedAt: 0,
    activeRunId: () => null,
    regenerate: jest.fn(),
    error: undefined,
    busy: false,
    sessionId: 's1',
    history: 'ready' as const,
    fresh: true,
    send: jest.fn(),
    stop: jest.fn(async () => {}),
    retry: jest.fn(),
}

const COWORKER = { id: 'a1', kind: 'coworker' as const, name: 'Scout', role: 'Sales', status: 'idle' as const }

describe('ConversationPane', () => {
    it('veils the transcript under the footer, opaque below it and fading over the band above', async () => {
        await render(<ConversationPane coworker={COWORKER} makeEndpoints={() => coworkerEndpoints('a1')} initialSessionId="s1" onSessionCreated={jest.fn()} models={null} status={null} onStatusChange={jest.fn()} webUrl="" />)

        expect(screen.getByTestId('suggestions')).toBeOnTheScreen()
        expect(screen.getByText('Stop here')).toBeOnTheScreen()
        expect(screen.getByTestId('composer')).toBeOnTheScreen()

        await fireEvent(screen.getByTestId('conversation-footer'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 120 } } })

        expect(screen.getByTestId(`edge-fade:bottom:${120 + BLUR_ABOVE_FOOTER}:120`)).toBeOnTheScreen()
    })
})
