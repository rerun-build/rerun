import { pendingCodexPlanLimits } from './codex-plan-limits.js'
import { pendingOpencodePlanLimits } from './opencode-plan-limits.js'
import type { LoadedConnection } from './types.js'

// Waits for the plan-limit reads in flight at the moment of the call, capped since a CLI that hangs
// must not hold anyone. The order of the call decides what is waited for: the connections list
// calls it before its stale refreshes, so the rings it draws are the run's and the pickers never
// wait on a read the list itself started; `ai_status` calls it after them, so the coworker answers
// with a fresh reading of the quota it was asked about.
const PENDING_PLAN_LIMITS_MAX_WAIT_MS = 5_000

export async function awaitPendingPlanLimits(connections: LoadedConnection[]): Promise<void> {
    const pending = connections.flatMap(connection => [pendingCodexPlanLimits(connection.id), pendingOpencodePlanLimits(connection.id)].filter((read): read is Promise<void> => !!read))
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
