// A stand-in for the Supabase client's Realtime side: every channel opened, what it listens to, and
// the status callback it handed to `subscribe`, so a test can play a join, a drop or a change.
// Use it from a module mock: `jest.mock('@/auth/supabase', () => ({ supabase: require('@/test/realtime').fakeSupabase }))`.

type ChannelStatus = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT'
type Binding = { event: string; table: string; filter?: string; callback: () => void }

export type FakeChannel = {
    topic: string
    bindings: Binding[]
    removed: boolean
    status: ((status: ChannelStatus) => void) | null
    on: (type: string, spec: { event: string; table: string; filter?: string }, callback: () => void) => FakeChannel
    subscribe: (status?: (status: ChannelStatus) => void) => FakeChannel
}

const channels: FakeChannel[] = []

export const fakeSupabase = {
    channel(topic: string): FakeChannel {
        const channel: FakeChannel = {
            topic,
            bindings: [],
            removed: false,
            status: null,
            on(_type, spec, callback) {
                channel.bindings.push({ event: spec.event, table: spec.table, filter: spec.filter, callback })
                return channel
            },
            subscribe(status) {
                channel.status = status ?? null
                return channel
            },
        }
        channels.push(channel)
        return channel
    },
    // As the SDK does it: leaving a channel closes it, and its callback hears that CLOSED too.
    async removeChannel(channel: FakeChannel) {
        if (channel.removed) return 'ok'
        channel.removed = true
        channel.status?.('CLOSED')
        return 'ok'
    },
}

export const realtime = {
    reset: () => {
        channels.length = 0
    },
    all: () => [...channels],
    live: () => channels.filter(channel => !channel.removed),
    // Every channel still open reports the same status, as when the socket joins again or drops.
    report: (status: ChannelStatus) => realtime.live().forEach(channel => channel.status?.(status)),
    change: (table: string) =>
        realtime
            .live()
            .flatMap(channel => channel.bindings)
            .filter(binding => binding.table === table)
            .forEach(binding => binding.callback()),
}
