import type { Conversation } from '@rerun/contracts'
import { act, renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import { clearLocalCache } from '@/data/local-cache'
import { BURST_MS } from '@/data/useLiveReload'
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
        jest.useFakeTimers()
        clearLocalCache()
        realtime.reset()
        mockFetchConversations.mockReset()
        appStateListeners = []
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
            appStateListeners.push(listener as (state: AppStateStatus) => void)
            return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
        })
    })
    afterEach(() => jest.useRealTimers())

    it('follows the conversations of the coworker live', async () => {
        mockFetchConversations.mockResolvedValueOnce([general]).mockResolvedValue([general, startedOnTheWeb])
        const { result } = await renderHook(() => useCoworkerConversations('a1'))
        await act(async () => {})
        expect(realtime.live().flatMap(channel => channel.bindings)).toContainEqual(expect.objectContaining({ table: 'sessions', filter: 'agent_id=eq.a1' }))

        await act(async () => realtime.change('sessions'))
        await act(async () => jest.advanceTimersByTime(BURST_MS))

        expect(result.current.conversations.map(c => c.id)).toEqual(['from-the-web', 'general'])
    })

    it('reads once for the burst of writes a run makes, and reads the first time at once', async () => {
        mockFetchConversations.mockResolvedValue([general])
        await renderHook(() => useCoworkerConversations('a1'))
        await act(async () => {})
        expect(mockFetchConversations).toHaveBeenCalledTimes(1)

        // A run starting: its status, its preview, its engine session id, its title.
        await act(async () => {
            for (let i = 0; i < 4; i++) {
                realtime.change('sessions')
                jest.advanceTimersByTime(100)
            }
        })
        expect(mockFetchConversations).toHaveBeenCalledTimes(1)
        await act(async () => jest.advanceTimersByTime(BURST_MS))
        expect(mockFetchConversations).toHaveBeenCalledTimes(2)
    })

    it('drops a read still waiting when the screen goes away', async () => {
        mockFetchConversations.mockResolvedValue([general])
        const { unmount } = await renderHook(() => useCoworkerConversations('a1'))
        await act(async () => {})
        await act(async () => realtime.change('sessions'))
        await act(async () => unmount())
        await act(async () => jest.advanceTimersByTime(BURST_MS * 2))
        expect(mockFetchConversations).toHaveBeenCalledTimes(1)
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
        await act(async () => jest.advanceTimersByTime(BURST_MS))

        expect(result.current.conversations).toContainEqual(expect.objectContaining({ id: 'from-the-web', status: 'working' }))
    })

    it('follows the Foreman\'s own conversations, those of the person signed in', async () => {
        mockFetchConversations.mockResolvedValueOnce([general]).mockResolvedValue([general, startedOnTheWeb])
        const { result } = await renderHook(() => useForemanConversations())
        await act(async () => {})
        expect(realtime.live().flatMap(channel => channel.bindings)).toContainEqual(expect.objectContaining({ table: 'foreman_conversations', filter: 'user_id=eq.u1' }))

        await act(async () => realtime.change('foreman_conversations'))
        await act(async () => jest.advanceTimersByTime(BURST_MS))

        expect(result.current.conversations.map(c => c.id)).toEqual(['from-the-web', 'general'])
    })
})
