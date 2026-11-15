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
    report: (status: ChannelStatus) => realtime.live().forEach(channel => channel.status?.(status)),
    change: (table: string) =>
        realtime
            .live()
            .flatMap(channel => channel.bindings)
            .filter(binding => binding.table === table)
            .forEach(binding => binding.callback()),
}
