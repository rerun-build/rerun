import { pendingClaudePlanLimits } from './claude-plan-limits.js'
import { pendingCodexPlanLimits } from './codex-plan-limits.js'
import { pendingOpencodePlanLimits } from './opencode-plan-limits.js'
import type { LoadedConnection } from './types.js'

// Waits for the plan-limit reads in flight at the moment of the call, capped since a CLI that hangs
// must not hold anyone. The order of the call decides what is waited for: the plain connections list
// calls it before its stale refreshes, so it waits on a run's read or one an earlier list started,
// never on its own; the list with `?fresh=1` (the AI providers panel) and `ai_status` call it after
// them, so they answer with the reading they just started.
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
