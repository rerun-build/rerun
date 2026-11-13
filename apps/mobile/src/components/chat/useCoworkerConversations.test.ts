import type { Conversation } from '@rerun/contracts'
import { act, renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import { clearLocalCache } from '@/data/local-cache'
import { realtime } from '@/test/realtime'

import { useCoworkerConversations, useForemanConversations } from './useCoworkerConversations'

const mockFetchConversations = jest.fn<Promise<Conversation[]>, []>()

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('@/api/chat', () => ({ fetchAgentConversations: () => mockFetchConversations() }))
jest.mock('@/api/foreman', () => ({ fetchForemanConversations: () => mockFetchConversations() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't' }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))
jest.mock('@/auth/supabase', () => ({ supabase: require('@/test/realtime').fakeSupabase }))

const conversation = (id: string, extra: Partial<Conversation> = {}): Conversation => ({ id, agentId: 'a1', engineSessionId: `engine-${id}`, title: id, status: 'idle', source: 'dashboard', updatedAt: '2026-11-12T09:00:00Z', originAgentName: null, kind: 'thread', createdAt: '2026-11-12T09:00:00Z', ...extra })

const general = conversation('general', { kind: 'general' })
const startedOnTheWeb = conversation('from-the-web', { status: 'working', updatedAt: '2026-11-12T10:00:00Z' })

let appStateListeners: ((state: AppStateStatus) => void)[] = []

describe('useCoworkerConversations', () => {
    beforeEach(() => {
        clearLocalCache()
        realtime.reset()
        mockFetchConversations.mockReset()
        appStateListeners = []
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
            appStateListeners.push(listener as (state: AppStateStatus) => void)
            return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
        })
    })

    it('follows the conversations of the coworker live', async () => {
        mockFetchConversations.mockResolvedValueOnce([general]).mockResolvedValue([general, startedOnTheWeb])
        const { result } = await renderHook(() => useCoworkerConversations('a1'))
        await act(async () => {})
        expect(realtime.live().flatMap(channel => channel.bindings)).toContainEqual(expect.objectContaining({ table: 'sessions', filter: 'agent_id=eq.a1' }))

        await act(async () => realtime.change('sessions'))

        expect(result.current.conversations.map(c => c.id)).toEqual(['from-the-web', 'general'])
    })

    // RER-7: iOS holds the app while the web starts the chat, the INSERT and the UPDATE go by unheard,
    // and the run writes its row again only when it ends.
    it('shows a chat started on the web while the app was away, as soon as the app is back', async () => {
        mockFetchConversations.mockResolvedValueOnce([general]).mockResolvedValue([general, startedOnTheWeb])
        const { result } = await renderHook(() => useCoworkerConversations('a1'))
        await act(async () => {})
        expect(result.current.conversations.map(c => c.id)).toEqual(['general'])

        await act(async () => appStateListeners.forEach(listener => listener('background')))
        await act(async () => appStateListeners.forEach(listener => listener('active')))

        expect(result.current.conversations).toContainEqual(expect.objectContaining({ id: 'from-the-web', status: 'working' }))
    })

    it('follows the Foreman\'s own conversations, those of the person signed in', async () => {
        mockFetchConversations.mockResolvedValueOnce([general]).mockResolvedValue([general, startedOnTheWeb])
        const { result } = await renderHook(() => useForemanConversations())
        await act(async () => {})
        expect(realtime.live().flatMap(channel => channel.bindings)).toContainEqual(expect.objectContaining({ table: 'foreman_conversations', filter: 'user_id=eq.u1' }))

        await act(async () => realtime.change('foreman_conversations'))

        expect(result.current.conversations.map(c => c.id)).toEqual(['from-the-web', 'general'])
    })
})
