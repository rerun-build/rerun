import { useMemo, useState } from 'react'

type TimedMessage = { id: string; metadata?: unknown }

const createdAtOf = (message: TimedMessage) => {
    const createdAt = (message.metadata as { createdAt?: unknown } | undefined)?.createdAt
    return typeof createdAt === 'string' ? createdAt : undefined
}

export function useMessageTimes(messages: readonly TimedMessage[]): string[] {
    const [firstSeen] = useState(() => new Map<string, string>())
    return useMemo(
        () =>
            messages.map(message => {
                const createdAt = createdAtOf(message)
                if (createdAt) return createdAt
                const seen = firstSeen.get(message.id) ?? new Date().toISOString()
                firstSeen.set(message.id, seen)
                return seen
            }),
        [messages, firstSeen]
    )
}
