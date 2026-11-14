'use client'

import { useMemo } from 'react'

import { isScheduledSource } from '@/lib/notifications/prefs'
import { groupUnseenRuns, type UnseenGroup } from '@/lib/notifications/unseen-runs'
import { useBoardStore } from '@/stores/board.store'
import { useUnseenRunsStore } from '@/stores/unseen-runs.store'

export type LabeledUnseenGroup = UnseenGroup & { label: string; scheduled: boolean }

export function useUnseenGroups(): LabeledUnseenGroup[] {
    const runs = useUnseenRunsStore(state => state.runs)
    const schedules = useBoardStore(state => state.agentSchedules)
    return useMemo(() => {
        const names = new Map(schedules.map(s => [`${s.agentId}:${s.slug}`, s.name]))
        return groupUnseenRuns(runs).map(group => {
            const scheduled = isScheduledSource(group.source) && !!group.slug
            const label = scheduled ? ((group.source === 'schedule' && names.get(`${group.agentId}:${group.slug}`)) || group.slug!) : group.title
            return { ...group, label, scheduled }
        })
    }, [runs, schedules])
}
