'use client'

import { useMemo } from 'react'

import { isScheduledSource } from '@/lib/notifications/prefs'
import { groupUnseenRuns, unseenGroupLabel, type UnseenGroup } from '@/lib/notifications/unseen-runs'
import { useBoardStore } from '@/stores/board.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'

export type LabeledUnseenGroup = UnseenGroup & { label: string; scheduled: boolean }

// The unseen runs as the inbox and the board show them: a scheduled task under its name rather than
// the `schedule: <slug>` title its sessions carry.
export function useUnseenGroups(): LabeledUnseenGroup[] {
    const runs = useUnseenRunsStore(state => state.runs)
    const schedules = useBoardStore(state => state.agentSchedules)
    return useMemo(() => {
        const names = new Map(schedules.map(s => [`${s.agentId}:${s.slug}`, s.name]))
        return groupUnseenRuns(runs).map(group => ({ ...group, label: unseenGroupLabel(group, names), scheduled: isScheduledSource(group.source) && !!group.slug }))
    }, [runs, schedules])
}
