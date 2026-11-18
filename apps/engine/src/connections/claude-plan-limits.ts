import { logger } from '../lib/logger.js'
import { acquireClaudeLease, claudeTokenOf, ensureFreshClaudeToken } from './claude-token.js'
import { planLimitWindowsFromClaudeUsage, readPlanLimits, recordPlanLimits, type ClaudeUsageAnswer } from './plan-limits.js'
import type { LoadedConnection } from './types.js'

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20'
const READ_TIMEOUT_MS = 8000
const STALE_AFTER_MS = 5 * 60_000
// A run that fails within seconds, again and again, must not turn into as many reads.
const AFTER_RUN_MIN_GAP_MS = 60_000

const inFlight = new Map<string, Promise<void>>()
const attemptedAt = new Map<string, number>()

// The endpoint behind the CLI's `/usage`, which a run already reads in its Stop hook, asked off a
// run so the usage spent outside Rerun (Claude Desktop, Claude Code elsewhere) shows before the next
// run ends. Only a sign-in token carries the profile scope it needs: a `claude setup-token` value
// would be refused on every ask, so it is never sent. Nothing here flags the token as refused: a
// run answered with a 401 does that.
export function refreshClaudePlanLimits(connection: LoadedConnection | null): Promise<void> {
    if (!connection || connection.config.provider !== 'claude' || !claudeTokenOf(connection) || !connection.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN) return Promise.resolve()

    const pending = inFlight.get(connection.id)
    if (pending) return pending

    attemptedAt.set(connection.id, Date.now())
    const task = (async () => {
        await ensureFreshClaudeToken(connection)
        // Held for the request: a rotation revokes the token it was sent with.
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

// Paced on the last attempt and on the last reading alike: a run that just ended read the usage in
// its Stop hook, and asking again seconds later would only cost a request.
export function refreshStaleClaudePlanLimits(connections: LoadedConnection[]): void {
    const now = Date.now()
    for (const connection of connections) {
        if (connection.config.provider !== 'claude') continue
        if (now - Math.max(attemptedAt.get(connection.id) ?? 0, lastReadingAt(connection.id)) < STALE_AFTER_MS) continue
        void refreshClaudePlanLimits(connection)
    }
}

// The Stop hook only reads when a turn ends well: a cancelled run, a run that failed, or one the plan
// refused leaves nothing behind, and the refused one is when the reset time matters most.
export function refreshClaudePlanLimitsAfterRun(connection: LoadedConnection | null, runStartedAt: number): void {
    if (!connection || lastReadingAt(connection.id) >= runStartedAt) return
    if (Date.now() - (attemptedAt.get(connection.id) ?? 0) < AFTER_RUN_MIN_GAP_MS) return
    void refreshClaudePlanLimits(connection)
}

export function forgetClaudePlanLimitsAttempt(connectionId: string): void {
    attemptedAt.delete(connectionId)
}
