// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRealtimeSubscription } from './useRealtimeSubscription'

let joined: ((status: string) => void) | null = null
const channel = {
    state: 'joining',
    on: () => channel,
    subscribe: (callback: (status: string) => void) => {
        joined = callback
        return channel
    },
}
const opened = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/supabase/client', () => ({
    createClient: () => ({
        channel: () => {
            opened.count++
            return channel
        },
        removeChannel: async () => {},
    }),
}))

let root: Root | null = null
let visibility: DocumentVisibilityState = 'visible'

async function subscribe(onResync: () => void) {
    function Probe() {
        useRealtimeSubscription('sessions', { channelId: 'session-transcript-1', filter: { column: 'id', value: 'session-1' }, onUpdate: () => {}, onResync })
        return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root!.render(createElement(Probe)))
}

function showPage(state: DocumentVisibilityState) {
    visibility = state
    document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
    vi.useFakeTimers()
    joined = null
    opened.count = 0
    channel.state = 'joining'
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})

afterEach(() => {
    act(() => root?.unmount())
    root = null
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('useRealtimeSubscription resync', () => {
    it('asks to read again when the tab comes back to the foreground, not when it leaves', async () => {
        const onResync = vi.fn()
        await subscribe(onResync)
        showPage('hidden')
        vi.advanceTimersByTime(500)
        expect(onResync).not.toHaveBeenCalled()
        showPage('visible')
        vi.advanceTimersByTime(500)
        expect(onResync).toHaveBeenCalledTimes(1)
    })

    it('asks once for a return to the foreground and to the network at the same moment', async () => {
        const onResync = vi.fn()
        await subscribe(onResync)
        showPage('visible')
        window.dispatchEvent(new Event('online'))
        vi.advanceTimersByTime(500)
        expect(onResync).toHaveBeenCalledTimes(1)
    })

    it('asks again once the channel has joined, after a first connection or a reconnection', async () => {
        const onResync = vi.fn()
        await subscribe(onResync)
        joined?.('SUBSCRIBED')
        vi.advanceTimersByTime(500)
        expect(onResync).toHaveBeenCalledTimes(1)
    })

    it('stops asking once unmounted', async () => {
        const onResync = vi.fn()
        await subscribe(onResync)
        act(() => root?.unmount())
        root = null
        showPage('visible')
        window.dispatchEvent(new Event('online'))
        vi.advanceTimersByTime(500)
        expect(onResync).not.toHaveBeenCalled()
    })
})

describe('useRealtimeSubscription recovery', () => {
    it('leaves a channel that errored to realtime-js instead of opening another one', async () => {
        await subscribe(() => {})
        channel.state = 'errored'
        act(() => joined?.('CHANNEL_ERROR'))
        vi.advanceTimersByTime(5000)
        channel.state = 'joined'
        act(() => joined?.('SUBSCRIBED'))
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000)
        })
        expect(opened.count).toBe(1)
    })

    it('opens a new channel when the server closed the old one', async () => {
        await subscribe(() => {})
        channel.state = 'closed'
        act(() => joined?.('CLOSED'))
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000)
        })
        expect(opened.count).toBe(2)
    })
})
