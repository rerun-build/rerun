// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRealtimeSubscription } from './useRealtimeSubscription'

let joined: ((status: string) => void) | null = null
const channel = {
    on: () => channel,
    subscribe: (callback: (status: string) => void) => {
        joined = callback
        return channel
    },
}
vi.mock('@/supabase/client', () => ({ createClient: () => ({ channel: () => channel, removeChannel: async () => {} }) }))

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
