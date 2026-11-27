// @vitest-environment happy-dom
import { RealtimeClient, type RealtimeChannel } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createChannelRecovery } from './channel-recovery'

const MINUTE = 60_000

// The real realtime-js on a socket that can lose its network: what a fake channel cannot show is the
// join each `subscribe()` queues while the socket is down, all sent when it reopens.
let online = true
const sockets: FakeSocket[] = []
const joins: string[] = []

class FakeSocket {
    readyState = 0
    binaryType = 'arraybuffer'
    onopen: (() => void) | null = null
    onclose: ((event: unknown) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null

    constructor() {
        sockets.push(this)
        setTimeout(() => {
            if (online) {
                this.readyState = 1
                this.onopen?.()
                return
            }
            this.readyState = 3
            this.onerror?.(new Event('error'))
            this.onclose?.({ code: 1006, wasClean: false })
        }, 5)
    }

    send(data: string) {
        const [joinRef, ref, topic, event] = JSON.parse(data) as [string | null, string | null, string, string]
        if (event === 'phx_join') joins.push(topic)
        setTimeout(() => this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]) }), 1)
    }

    close() {
        this.readyState = 3
        setTimeout(() => this.onclose?.({ code: 1000, wasClean: true }), 0)
    }

    loseNetwork() {
        online = false
        this.readyState = 3
        this.onclose?.({ code: 1006, wasClean: false })
    }
}

describe('channel recovery through a network outage', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        online = true
        sockets.length = 0
        joins.length = 0
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it.each([1, 10, 60])('sends one join when the network returns after %i minute(s), on a page left visible', async minutes => {
        const client = new RealtimeClient('ws://localhost/realtime/v1', { params: { apikey: 'key' }, transport: FakeSocket as unknown as typeof WebSocket })
        const statuses: string[] = []
        let replacements = 0
        let current: RealtimeChannel | null = null
        const recovery = createChannelRecovery(async () => {
            replacements++
            if (current) await client.removeChannel(current)
            current = connect()
        })
        const connect = () => {
            const channel = client.channel(`board:${replacements}`)
            channel.on('broadcast', { event: 'moved' }, () => {})
            recovery.watch(channel)
            channel.subscribe(status => {
                statuses.push(status)
                recovery.onStatus(channel, status)
            })
            return channel
        }
        current = connect()
        await vi.advanceTimersByTimeAsync(1000)
        expect(statuses).toEqual(['SUBSCRIBED'])

        sockets.at(-1)!.loseNetwork()
        await vi.advanceTimersByTimeAsync(minutes * MINUTE)
        joins.length = 0
        online = true
        await vi.advanceTimersByTimeAsync(MINUTE)

        expect(replacements).toBe(0)
        expect(joins).toEqual(['realtime:board:0'])
        expect(statuses.at(-1)).toBe('SUBSCRIBED')

        recovery.dispose()
        await client.removeChannel(current)
        client.disconnect()
    })
})
