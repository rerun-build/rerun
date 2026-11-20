import { logger } from '../lib/logger.js'
import { acquireClaudeLease, claudeTokenOf, ensureFreshClaudeToken } from './claude-token.js'
import { planLimitWindowsFromClaudeUsage, readPlanLimits, recordPlanLimits, type ClaudeUsageAnswer } from './plan-limits.js'
import type { LoadedConnection } from './types.js'

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20'
const READ_TIMEOUT_MS = 8000
const STALE_AFTER_MS = 5 * 60_000
const AFTER_RUN_MIN_GAP_MS = 60_000

const inFlight = new Map<string, Promise<void>>()
const attemptedAt = new Map<string, number>()

export function refreshClaudePlanLimits(connection: LoadedConnection | null): Promise<void> {
    if (!connection || connection.config.provider !== 'claude' || !claudeTokenOf(connection) || !connection.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN) return Promise.resolve()

    const pending = inFlight.get(connection.id)
    if (pending) return pending

    attemptedAt.set(connection.id, Date.now())
    const task = (async () => {
        await ensureFreshClaudeToken(connection)
        const release = acquireClaudeLease(connection)
        try {
            const response = await fetch(CLAUDE_USAGE_URL, {
                headers: { Authorization: `Bearer ${claudeTokenOf(connection)}`, 'anthropic-beta': CLAUDE_OAUTH_BETA },
                redirect: 'error',
                signal: AbortSignal.timeout(READ_TIMEOUT_MS),
            })
            if (!response.ok) {
                logger.warn({ connection: connection.id, status: response.status }, 'claude plan limits read refused')
                return
            }
            recordPlanLimits(connection.id, planLimitWindowsFromClaudeUsage((await response.json().catch(() => null)) as ClaudeUsageAnswer | null))
        } finally {
            release()
        }
    })()
        .catch(err => logger.warn({ connection: connection.id, err: (err as Error).message }, 'claude plan limits read failed'))
        .finally(() => inFlight.delete(connection.id))

    inFlight.set(connection.id, task)
    return task
}

export function pendingClaudePlanLimits(connectionId: string): Promise<void> | undefined {
    return inFlight.get(connectionId)
}

function lastReadingAt(connectionId: string): number {
    return Date.parse(readPlanLimits(connectionId)?.capturedAt ?? '') || 0
}

export function refreshStaleClaudePlanLimits(connections: LoadedConnection[]): void {
    const now = Date.now()
    for (const connection of connections) {
        if (connection.config.provider !== 'claude') continue
        if (now - Math.max(attemptedAt.get(connection.id) ?? 0, lastReadingAt(connection.id)) < STALE_AFTER_MS) continue
        void refreshClaudePlanLimits(connection)
    }
}

export function refreshClaudePlanLimitsAfterRun(connection: LoadedConnection | null, runStartedAt: number): void {
    if (!connection || lastReadingAt(connection.id) >= runStartedAt) return
    if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < AFTER_RUN_MIN_GAP_MS) return
    void refreshClaudePlanLimits(connection)
}

export function forgetClaudePlanLimitsAttempt(connectionId: string): void {
    attemptedAt.delete(connectionId)
}
