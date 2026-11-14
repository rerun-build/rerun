import { createHash } from 'node:crypto'
import { PostHog } from 'posthog-node'
import type { AnalyticsEventMap, EventName } from './index'

let client: PostHog | null = null

function getClient(): PostHog | null {
    const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
    if (!token) return null
    if (!client) {
        client = new PostHog(token, {
            host: 'https://eu.i.posthog.com',
            flushAt: 1,
            flushInterval: 0,
        })
    }
    return client
}

export function deterministicUuid(seed: string): string {
    const hash = createHash('sha1').update(seed).digest('hex')
    const bytes = hash.slice(0, 32).split('')
    bytes[12] = '5'
    bytes[16] = ((parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16)
    const hex = bytes.join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export async function captureServer<E extends EventName>(
    distinctId: string,
    event: E,
    properties: AnalyticsEventMap[E],
    opts?: { uuid?: string; timestamp?: Date },
) {
    const ph = getClient()
    if (!ph) return
    ph.capture({ distinctId, event, properties, uuid: opts?.uuid, timestamp: opts?.timestamp })
    await ph.flush()
}
