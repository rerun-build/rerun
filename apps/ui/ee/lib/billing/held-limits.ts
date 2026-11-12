import type { WorkspaceLimitColumns } from './plans'

// null = unlimited, so it wins any max.
export function maxLimit(a: number | null, b: number | null): number | null {
    if (a === null || b === null) return null
    return Math.max(a, b)
}

export type HeldLimitColumns = Pick<WorkspaceLimitColumns, 'max_agents' | 'max_seats' | 'rerun_budget_micros'>

// Mid-period, a limit only ever goes up: an increase lands at once, a decrease waits for the period
// to advance, so whoever bills the workspace never takes back what was paid for before the renewal.
export function mergeHeldLimits(existing: HeldLimitColumns, derived: WorkspaceLimitColumns): WorkspaceLimitColumns {
    return {
        ...derived,
        max_agents: maxLimit(existing.max_agents, derived.max_agents),
        max_seats: maxLimit(existing.max_seats, derived.max_seats),
        rerun_budget_micros: Math.max(existing.rerun_budget_micros ?? 0, derived.rerun_budget_micros),
    }
}
