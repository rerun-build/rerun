import { GROK_PROXY_BASE_URL } from '@rerun/contracts'
import { logger } from '../lib/logger.js'
import { recordCliModels } from './cli-models.js'
import { grokFetch } from './grok-proxy.js'
import type { LoadedConnection } from './types.js'

const READ_TIMEOUT_MS = 8000
const STALE_AFTER_MS = 24 * 60 * 60_000

const inFlight = new Map<string, Promise<void>>()
const attemptedAt = new Map<string, number>()

type GrokModelEntry = { id?: unknown; api_backend?: unknown }

// The chat models the account is served, as Grok Build lists them: the ones its agent loop talks
// to over the Responses API. Anything else (an image or a video model) is not a coworker's model.
export function grokChatModels(body: unknown): string[] {
    const data = (body as { data?: unknown } | null)?.data
    if (!Array.isArray(data)) return []
    return data.flatMap((entry: GrokModelEntry) => (typeof entry?.id === 'string' && (entry.api_backend === undefined || entry.api_backend === 'responses') ? [entry.id] : []))
}

// Read when a connection arrives, before it adopts a default, then once a day: what the account is
// served moves with its plan, rarely within a day. A failed read keeps the last one, and no reading
// refuses nothing.
export function refreshGrokModels(connection: LoadedConnection | null): Promise<void> {
    if (!connection || connection.config.provider !== 'grok') return Promise.resolve()

    const pending = inFlight.get(connection.id)
    if (pending) return pending

    attemptedAt.set(connection.id, Date.now())
    const task = (async () => {
        const response = await grokFetch({ connection, sessionId: `models-${connection.id}` })(`${GROK_PROXY_BASE_URL}/models`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
        if (!response.ok) {
            await response.body?.cancel()
            logger.warn({ connection: connection.id, status: response.status }, 'grok model list refused')
            return
        }
        recordCliModels(connection.id, grokChatModels(await response.json().catch(() => null)), null, false)
    })()
        .catch(err => logger.warn({ connection: connection.id, err: err instanceof Error ? err.message : String(err) }, 'grok model list read failed'))
        .finally(() => inFlight.delete(connection.id))

    inFlight.set(connection.id, task)
    return task
}

export function refreshStaleGrokModels(connections: LoadedConnection[]): void {
    for (const connection of connections) {
        if (connection.config.provider !== 'grok') continue
        if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < STALE_AFTER_MS) continue
        void refreshGrokModels(connection)
    }
}

export function forgetGrokModelsAttempt(connectionId: string): void {
    attemptedAt.delete(connectionId)
}
