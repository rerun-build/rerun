import { GROK_PROXY_BASE_URL } from '@rerun/contracts'
import { logger } from '../lib/logger.js'
import { grokFetch } from './grok-proxy.js'
import { planLimitWindowsFromGrok, recordPlanLimits } from './plan-limits.js'
import type { LoadedConnection } from './types.js'

const READ_TIMEOUT_MS = 8000
const STALE_AFTER_MS = 5 * 60_000

const inFlight = new Map<string, Promise<void>>()
const attemptedAt = new Map<string, number>()

// The week's allowance as Grok Build reads it. A reading that fails or comes back in a shape the
// parser does not know leaves the last one in place, never a made-up one.
export function refreshGrokPlanLimits(connection: LoadedConnection | null): Promise<void> {
    if (!connection || connection.config.provider !== 'grok') return Promise.resolve()

    const pending = inFlight.get(connection.id)
    if (pending) return pending

    attemptedAt.set(connection.id, Date.now())
    const task = (async () => {
        const response = await grokFetch({ connection, sessionId: `plan-limits-${connection.id}` })(`${GROK_PROXY_BASE_URL}/billing?format=credits`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
        if (!response.ok) {
            await response.body?.cancel()
            logger.warn({ connection: connection.id, status: response.status }, 'grok plan limits read refused')
            return
        }
        const windows = planLimitWindowsFromGrok(await response.json().catch(() => null))
        if (!windows.length) logger.warn({ connection: connection.id }, 'grok plan limits answer in a shape not known: no reading kept')
        recordPlanLimits(connection.id, windows)
    })()
        .catch(err => logger.warn({ connection: connection.id, err: err instanceof Error ? err.message : String(err) }, 'grok plan limits read failed'))
        .finally(() => inFlight.delete(connection.id))

    inFlight.set(connection.id, task)
    return task
}

export function pendingGrokPlanLimits(connectionId: string): Promise<void> | undefined {
    return inFlight.get(connectionId)
}

// For the paths that answer with the reading they have: paced on the last attempt.
export function refreshStaleGrokPlanLimits(connections: LoadedConnection[]): void {
    for (const connection of connections) {
        if (connection.config.provider !== 'grok') continue
        if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < STALE_AFTER_MS) continue
        void refreshGrokPlanLimits(connection)
    }
}

export function forgetGrokPlanLimitsAttempt(connectionId: string): void {
    attemptedAt.delete(connectionId)
}
