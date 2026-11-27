// @vitest-environment happy-dom
import type { RealtimeChannel } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createChannelRecovery } from './channel-recovery'

const SECOND = 1000

let visibility: DocumentVisibilityState = 'visible'
function showPage(state: DocumentVisibilityState) {
    visibility = state
    document.dispatchEvent(new Event('visibilitychange'))
}

let socketConnected = true
function fakeChannel(state = 'joined') {
    return { state, socket: { isConnected: () => socketConnected } } as unknown as RealtimeChannel & { state: string }
}

describe('createChannelRecovery', () => {
    const replace = vi.fn()
    let recovery: ReturnType<typeof createChannelRecovery>

    beforeEach(() => {
        vi.useFakeTimers()
        visibility = 'visible'
        socketConnected = true
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
        replace.mockReset()
        recovery = createChannelRecovery(replace)
    })

    afterEach(() => {
        recovery.dispose()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('leaves a channel that errored to realtime-js, which rejoins it once the socket is back', () => {
        const channel = fakeChannel('errored')
        recovery.watch(channel)
        recovery.onStatus(channel, 'CHANNEL_ERROR')
        vi.advanceTimersByTime(5 * SECOND)
        channel.state = 'joined'
        recovery.onStatus(channel, 'SUBSCRIBED')
        vi.advanceTimersByTime(60 * SECOND)
        expect(replace).not.toHaveBeenCalled()
    })

    it('replaces a channel still not joined well after an error', () => {
        const channel = fakeChannel('errored')
        recovery.watch(channel)
        recovery.onStatus(channel, 'TIMED_OUT')
        vi.advanceTimersByTime(30 * SECOND)
        expect(replace).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1 * SECOND)
        expect(replace).toHaveBeenCalledTimes(1)
    })

    it('replaces nothing while the socket is down, however long: realtime-js rejoins the channel when it reopens', () => {
        const channel = fakeChannel('errored')
        recovery.watch(channel)
        socketConnected = false
        recovery.onStatus(channel, 'CHANNEL_ERROR')
        vi.advanceTimersByTime(10 * 60 * SECOND)
        expect(replace).not.toHaveBeenCalled()
    })

    it('replaces a channel still not joined a while after the socket came back', () => {
        const channel = fakeChannel('errored')
        recovery.watch(channel)
        socketConnected = false
        recovery.onStatus(channel, 'CHANNEL_ERROR')
        vi.advanceTimersByTime(45 * SECOND)
        socketConnected = true
        vi.advanceTimersByTime(14 * SECOND)
        expect(replace).not.toHaveBeenCalled()
        vi.advanceTimersByTime(2 * SECOND)
        expect(replace).toHaveBeenCalledTimes(1)
    })

    it('replaces a channel the server closed, since realtime-js never rejoins it', () => {
        const channel = fakeChannel('closed')
        recovery.watch(channel)
        recovery.onStatus(channel, 'CLOSED')
        vi.advanceTimersByTime(1 * SECOND)
        expect(replace).toHaveBeenCalledTimes(1)
    })

    it('does not replace again when the replaced channel closes on its removal', () => {
        const channel = fakeChannel('closed')
        recovery.watch(channel)
        recovery.onStatus(channel, 'CLOSED')
        vi.advanceTimersByTime(1 * SECOND)
        recovery.onStatus(channel, 'CLOSED')
        vi.advanceTimersByTime(60 * SECOND)
        expect(replace).toHaveBeenCalledTimes(1)
    })

    it('waits for a hidden page to be shown before replacing a closed channel', () => {
        const channel = fakeChannel('closed')
        recovery.watch(channel)
        showPage('hidden')
        recovery.onStatus(channel, 'CLOSED')
        vi.advanceTimersByTime(10 * 60 * SECOND)
        expect(replace).not.toHaveBeenCalled()
        showPage('visible')
        vi.advanceTimersByTime(1 * SECOND)
        expect(replace).toHaveBeenCalledTimes(1)
    })

    it('gives an errored channel of a hidden page the same grace once shown, as realtime-js rejoins it then', () => {
        const channel = fakeChannel('errored')
        recovery.watch(channel)
        showPage('hidden')
        recovery.onStatus(channel, 'CHANNEL_ERROR')
        vi.advanceTimersByTime(10 * 60 * SECOND)
        showPage('visible')
        channel.state = 'joined'
        recovery.onStatus(channel, 'SUBSCRIBED')
        vi.advanceTimersByTime(60 * SECOND)
        expect(replace).not.toHaveBeenCalled()
    })

    it('ignores what an earlier channel says once another one is watched', () => {
        const first = fakeChannel('closed')
        recovery.watch(first)
        recovery.watch(fakeChannel())
        recovery.onStatus(first, 'CLOSED')
        vi.advanceTimersByTime(60 * SECOND)
        expect(replace).not.toHaveBeenCalled()
    })

    it('does nothing once disposed', () => {
        const channel = fakeChannel('errored')
        recovery.watch(channel)
        recovery.onStatus(channel, 'CHANNEL_ERROR')
        recovery.dispose()
        vi.advanceTimersByTime(60 * SECOND)
        expect(replace).not.toHaveBeenCalled()
    })
})
