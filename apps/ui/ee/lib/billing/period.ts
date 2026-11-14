export function hasPeriodAdvanced(stored: string | null | undefined, incoming: string | null | undefined): boolean {
    if (!incoming) return false
    const next = Date.parse(incoming)
    if (Number.isNaN(next)) return false
    if (!stored) return true

    const current = Date.parse(stored)
    if (Number.isNaN(current)) return false

    return next > current
}

type RerunPeriodUpdate = { rerun_used_micros?: number; rerun_period_anchor?: string }

export function rerunPeriodUpdate(advanced: boolean, status: string, now: string): RerunPeriodUpdate {
    if (!advanced) return {}
    if (status === 'trialing') return { rerun_period_anchor: now }
    return { rerun_used_micros: 0, rerun_period_anchor: now }
}
