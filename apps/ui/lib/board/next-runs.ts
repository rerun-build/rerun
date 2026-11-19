import type { TileCountdown } from '@moldwright/ui/iso-grid'

import type { EngineSchedule } from '@/lib/engine/types'
import { nextRunAt } from '@/lib/schedules/cron'

export type AgentSchedule = Pick<EngineSchedule, 'slug' | 'name' | 'cron' | 'runAt' | 'timezone' | 'enabled' | 'lastRunAt'> & { agentId: string }

export type NextRuns = Record<string, TileCountdown>

export function nextRunsByAgent(schedules: AgentSchedule[], now: number): NextRuns {
    const at = new Date(now)
    const runs: NextRuns = {}
    for (const schedule of schedules) {
        const next = nextRunAt(schedule, at)
        const due = next ? new Date(next).getTime() : null
        if (due == null || due <= now) continue
        const soonest = runs[schedule.agentId]
        if (!soonest || due < soonest.at) runs[schedule.agentId] = { at: due }
    }
    return runs
}

export function sameNextRuns(a: NextRuns, b: NextRuns): boolean {
    const ids = Object.keys(a)
    if (ids.length !== Object.keys(b).length) return false
    return ids.every(id => b[id] && a[id].at === b[id].at)
}
