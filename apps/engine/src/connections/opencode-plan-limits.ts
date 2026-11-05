import { CONNECTION_TOKEN_KEY, OPENCODE_USAGE_URL } from '@rerun/contracts'
import { logger } from '../lib/logger.js'
import { opencodeUserAgent } from '../runtime/build-info.js'
import { planLimitWindowsFromOpencode, recordPlanLimits } from './plan-limits.js'
import type { LoadedConnection } from './types.js'

const READ_TIMEOUT_MS = 8000
const STALE_AFTER_MS = 5 * 60_000

const inFlight = new Map<string, Promise<void>>()
const attemptedAt = new Map<string, number>()

// Nothing here ever flags the key as refused: what `/usage` answers a key with Console credits and no
// Go plan has not been measured, and a valid key read as refused would lock the user out. A run
// answered with a 401 is what raises it.
export function refreshOpencodePlanLimits(connection: LoadedConnection | null): Promise<void> {
    const key = connection?.config.provider === 'opencode' ? connection.env[CONNECTION_TOKEN_KEY.opencode] : undefined
    if (!connection || !key) return Promise.resolve()

    const pending = inFlight.get(connection.id)
    if (pending) return pending

    attemptedAt.set(connection.id, Date.now())
    const task = (async () => {
        const response = await fetch(OPENCODE_USAGE_URL, {
            headers: { Authorization: `Bearer ${key}`, 'User-Agent': opencodeUserAgent() },
            redirect: 'error',
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        })
        if (!response.ok) return
        recordPlanLimits(connection.id, planLimitWindowsFromOpencode(await response.json().catch(() => null)))
    })()
        .catch(err => logger.warn({ connection: connection.id, err: (err as Error).message }, 'opencode plan limits read failed'))
        .finally(() => inFlight.delete(connection.id))

    inFlight.set(connection.id, task)
    return task
}

// For the paths that answer with the reading they have: paced on the last attempt, so a key that
// cannot be read is not asked again on every list.
export function refreshStaleOpencodePlanLimits(connections: LoadedConnection[]): void {
    for (const connection of connections) {
        if (connection.config.provider !== 'opencode') continue
        if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < STALE_AFTER_MS) continue
        void refreshOpencodePlanLimits(connection)
    }
}

export function forgetOpencodePlanLimitsAttempt(connectionId: string): void {
    attemptedAt.delete(connectionId)
}
