import type { Inbox, InboxItem } from '@rerun/contracts'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { clearLocalCache } from '@/data/local-cache'
import { BURST_MS } from '@/data/useLiveReload'
import { realtime } from '@/test/realtime'

import { InboxProvider, useInbox } from './InboxProvider'

const mockFetchInbox = jest.fn<Promise<Inbox>, []>()
const mockMarkInboxRead = jest.fn<Promise<void>, [unknown, string[] | 'all']>()

jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }))
jest.mock('@/api/inbox', () => ({ fetchInbox: () => mockFetchInbox(), markInboxRead: (caller: unknown, ids: string[] | 'all') => mockMarkInboxRead(caller, ids) }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 't', user: { id: 'u1' } }, me: { user: { id: 'u1' }, workspace: { id: 7 } } }) }))
jest.mock('@/auth/supabase', () => ({ supabase: require('@/test/realtime').fakeSupabase }))
jest.mock('@/notifications/push', () => ({ setBadge: async () => {} }))

const item = (id: string): InboxItem => ({ id, sessionId: `s-${id}`, sessionIds: [`s-${id}`], agentId: 'a1', agentName: 'Scout', status: 'done', title: id, message: null, updatedAt: '2026-11-19T09:00:00Z', count: 1 })
const inboxWith = (...items: InboxItem[]): Inbox => ({ items, running: 0 })
const wrapper = ({ children }: { children: ReactNode }) => <InboxProvider>{children}</InboxProvider>

describe('InboxProvider', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        clearLocalCache()
        realtime.reset()
        mockFetchInbox.mockReset()
        mockMarkInboxRead.mockReset()
    })
    afterEach(() => jest.useRealTimers())

    it('reads once for a read marked and its echo through Realtime', async () => {
        mockFetchInbox.mockResolvedValueOnce(inboxWith(item('one'), item('two'))).mockResolvedValue(inboxWith(item('two')))
        mockMarkInboxRead.mockResolvedValue()
        const { result } = await renderHook(() => useInbox(), { wrapper })
        await act(async () => {})
        expect(mockFetchInbox).toHaveBeenCalledTimes(1)

        await act(async () => result.current.state === 'ready' && result.current.markRead([result.current.items[0]]))
        expect(result.current.state === 'ready' && result.current.items.map(i => i.id)).toEqual(['two'])
        await act(async () => realtime.change('session_reads'))
        await act(async () => jest.advanceTimersByTime(BURST_MS))

        expect(mockMarkInboxRead).toHaveBeenCalledWith(expect.anything(), ['s-one'])
        expect(mockFetchInbox).toHaveBeenCalledTimes(2)
        expect(result.current.state === 'ready' && result.current.items.map(i => i.id)).toEqual(['two'])
    })

    it('shows the rows again when the write fails', async () => {
        mockFetchInbox.mockResolvedValue(inboxWith(item('one'), item('two')))
        mockMarkInboxRead.mockRejectedValue(new Error('offline'))
        const { result } = await renderHook(() => useInbox(), { wrapper })
        await act(async () => {})

        await act(async () => result.current.state === 'ready' && result.current.markRead([result.current.items[0]]))
        await act(async () => jest.advanceTimersByTime(BURST_MS))

        expect(result.current.state === 'ready' && result.current.items.map(i => i.id)).toEqual(['one', 'two'])
    })

    it('reads once for a burst of Realtime changes', async () => {
        mockFetchInbox.mockResolvedValue(inboxWith(item('one')))
        await renderHook(() => useInbox(), { wrapper })
        await act(async () => {})
        await act(async () => {
            realtime.change('sessions')
            realtime.change('notifications')
            realtime.change('sessions')
        })
        await act(async () => jest.advanceTimersByTime(BURST_MS))
        expect(mockFetchInbox).toHaveBeenCalledTimes(2)
    })
})
