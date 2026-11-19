import { teamEmptyStateOf as teamEmptyStateFor, type TeamAgent, type TeamEmptyStateCopy, type TeamEmptyStateModel, type TeamPulse } from '@moldwright/contracts'

import type { AgentSchedule } from '@/lib/board/next-runs'
import { nextRunAt } from '@/lib/schedules/cron'

export type { TeamEmptyStateAction, TeamEmptyStateModel, TeamEmptyStateRow, TeamPulse } from '@moldwright/contracts'

function soonestRoutine(schedules: AgentSchedule[], now: number): TeamPulse['nextRoutine'] {
    const at = new Date(now)
    let soonest: TeamPulse['nextRoutine'] = null
    for (const schedule of schedules) {
        const next = nextRunAt(schedule, at)
        const due = next ? new Date(next).getTime() : null
        if (due == null || due <= now) continue
        if (!soonest || due < soonest.at) soonest = { name: schedule.name, at: due }
    }
    return soonest
}

export function teamEmptyStateOf({ agents, schedules, firstName, now, copy }: { agents: TeamAgent[]; schedules: AgentSchedule[]; firstName: string; now: number; copy?: TeamEmptyStateCopy }): TeamEmptyStateModel {
    return teamEmptyStateFor({ agents, firstName, nextRoutine: soonestRoutine(schedules, now), copy })
}
