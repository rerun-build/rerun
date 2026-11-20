import { pendingClaudePlanLimits } from './claude-plan-limits.js'
import { pendingCodexPlanLimits } from './codex-plan-limits.js'
import { pendingOpencodePlanLimits } from './opencode-plan-limits.js'
import type { LoadedConnection } from './types.js'

const PENDING_PLAN_LIMITS_MAX_WAIT_MS = 5_000

export async function awaitPendingPlanLimits(connections: LoadedConnection[]): Promise<void> {
    const pending = connections.flatMap(connection => [pendingClaudePlanLimits(connection.id), pendingCodexPlanLimits(connection.id), pendingOpencodePlanLimits(connection.id)].filter((read): read is Promise<void> => !!read))
    if (!pending.length) return
    let cap: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
        Promise.all(pending),
        new Promise<void>(resolve => {
            cap = setTimeout(resolve, PENDING_PLAN_LIMITS_MAX_WAIT_MS)
        }),
    ])
    if (cap) clearTimeout(cap)
}
