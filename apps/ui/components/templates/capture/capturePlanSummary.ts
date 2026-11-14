import type { AgentCapturePlan } from '@/lib/templates/capture'

export function flaggedPathSet(plan: AgentCapturePlan): Set<string> {
    return new Set(plan.files.filter(file => file.flagged.length > 0).map(file => file.path))
}

export type PlanStats = {
    total: number
    kept: number
    keptBytes: number
    flaggedTotal: number
    flaggedKept: string[]
}

export function planStats(plan: AgentCapturePlan, excluded: string[]): PlanStats {
    const dropped = new Set(excluded)
    const kept = plan.files.filter(file => !dropped.has(file.path))

    return {
        total: plan.files.length,
        kept: kept.length,
        keptBytes: kept.reduce((sum, file) => sum + file.bytes, 0),
        flaggedTotal: plan.files.filter(file => file.flagged.length > 0).length,
        flaggedKept: kept.filter(file => file.flagged.length > 0).map(file => file.path),
    }
}
