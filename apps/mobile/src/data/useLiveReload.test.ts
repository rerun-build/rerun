import type { RealtimeChannel } from '@supabase/supabase-js'
import { act, renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'

import { realtime } from '@/test/realtime'

import { useLiveReload } from './useLiveReload'

jest.mock('@/auth/supabase', () => ({ supabase: require('@/test/realtime').fakeSupabase }))

const listenToSessions = (channel: RealtimeChannel) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {})
}

let appStateListeners: ((state: AppStateStatus) => void)[] = []

describe('useLiveReload', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        realtime.reset()
        appStateListeners = []
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
            appStateListeners.push(listener as (state: AppStateStatus) => void)
            return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>
        })
    })
    afterEach(() => jest.useRealTimers())

    it('opens nothing before it knows what to listen to', async () => {
        await renderHook(() => useLiveReload(null, listenToSessions, jest.fn()))
        expect(realtime.all()).toHaveLength(0)
    })

    it('does not read again on the first join, the screen reads on mount already', async () => {
        const reload = jest.fn()
        await renderHook(() => useLiveReload('home:7', listenToSessions, reload))
        await act(async () => realtime.report('SUBSCRIBED'))
        expect(reload).not.toHaveBeenCalled()
    })

    it('reads again when the app comes back to the foreground', async () => {
        const reload = jest.fn()
        await renderHook(() => useLiveReload('home:7', listenToSessions, reload))
        await act(async () => appStateListeners.forEach(listener => listener('active')))
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('opens a single new channel for a failure reported twice, and reads again once it joins', async () => {
        const reload = jest.fn()
        await renderHook(() => useLiveReload('home:7', listenToSessions, reload))
        await act(async () => realtime.report('SUBSCRIBED'))

        await act(async () => {
            realtime.report('CHANNEL_ERROR')
            realtime.report('CLOSED')
        })
        await act(async () => jest.advanceTimersByTime(1000))

        expect(realtime.live()).toHaveLength(1)
        expect(realtime.all()).toHaveLength(2)
        expect(realtime.all()[1].topic).not.toBe(realtime.all()[0].topic)
        expect(realtime.all()[1].bindings).toEqual([expect.objectContaining({ table: 'sessions' })])

        await act(async () => realtime.report('SUBSCRIBED'))
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('waits longer after each failure, up to 15 seconds', async () => {
        await renderHook(() => useLiveReload('home:7', listenToSessions, jest.fn()))
        const delays = [1000, 2000, 4000, 8000, 15_000, 15_000]
        for (const delay of delays) {
            const opened = realtime.all().length
            await act(async () => realtime.report('TIMED_OUT'))
            await act(async () => jest.advanceTimersByTime(delay - 1))
            expect(realtime.all()).toHaveLength(opened)
            await act(async () => jest.advanceTimersByTime(1))
            expect(realtime.all()).toHaveLength(opened + 1)
        }
    })

    // A refreshed token gives the screen a new `reload`: the channel keeps going, on the new one.
    it('reaches the latest reload from the channel it already has open', async () => {
        const first = jest.fn()
        const second = jest.fn()
        const listen = (channel: RealtimeChannel, changed: () => void) => {
            channel.on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, changed)
        }
        const { rerender } = await renderHook(({ reload }: { reload: () => void }) => useLiveReload('home:7', listen, reload), { initialProps: { reload: first } })

        await act(async () => rerender({ reload: second }))
        await act(async () => realtime.change('sessions'))

        expect(realtime.all()).toHaveLength(1)
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
    })

    it('opens nothing again once the screen is gone, though leaving the channel closes it', async () => {
        const { unmount } = await renderHook(() => useLiveReload('home:7', listenToSessions, jest.fn()))
        await act(async () => realtime.report('SUBSCRIBED'))

        await act(async () => unmount())
        await act(async () => jest.advanceTimersByTime(60_000))

        expect(realtime.all()).toHaveLength(1)
        expect(realtime.live()).toHaveLength(0)
    })

    it('drops a pending retry when the screen goes', async () => {
        const { unmount } = await renderHook(() => useLiveReload('home:7', listenToSessions, jest.fn()))
        await act(async () => realtime.report('CLOSED'))

        await act(async () => unmount())
        await act(async () => jest.advanceTimersByTime(60_000))

        expect(realtime.all()).toHaveLength(1)
    })
})
