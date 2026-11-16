'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { testScheduleAction, updateScheduleAction, type WorkspaceRoutine, type WorkspaceRoutines } from '@/app/api/_actions/agent.actions'
import { adoptRunSession } from '@/components/agent/AgentRunHistory'
import { useErrorText } from '@/hooks/useErrorText'
import { nextRunAt, routineFrequency } from '@/lib/schedules/cron'
import { useBoardStore } from '@/stores/board.store'
import { routineKey } from '@rerun/ui/foreman'

// The engine writes a run's trigger slug a beat after the session row lands, so an immediate
// refetch on a new working session would still see the routine as idle.
const RUN_SETTLE_MS = 1500

function useNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(id)
    }, [intervalMs])
    return now
}

type UseRoutinesOptions = {
    // Stable: a new function reloads the list. Null when it could not be read: the list on screen stays.
    load: () => Promise<WorkspaceRoutines | null>
    // Only this coworker's runs reload the list; left out, any coworker's do.
    agentId?: string
    // False while the list is out of sight: nothing is read until it shows again.
    enabled?: boolean
    onRunStarted: (routine: WorkspaceRoutine, sessionId: string, runId: string) => void
}

const NO_ROUTINES: WorkspaceRoutines = { routines: [], canRename: false }

/**
 * A list of routines as `RoutineList` draws them, and what its rows do: pause or resume one, rename it,
 * run it now. The workspace's list (the Chief of Staff) and a coworker's own read and act the same way.
 */
export function useRoutines({ load, agentId, enabled = true, onRunStarted }: UseRoutinesOptions) {
    const locale = useLocale()
    const t = useTranslations('foreman.routines')
    const tAgent = useTranslations('agent')
    const errorText = useErrorText()
    const [data, setData] = useState<WorkspaceRoutines | null>(null)
    const [saving, setSaving] = useState<string[]>([])
    const [renamingKey, setRenamingKey] = useState<string | null>(null)
    // A switched row keeps the place it had when it was switched, until that hour has passed: paused,
    // it would otherwise drop at once into the folded Paused group, out of sight of the hand that did it.
    const [heldNextRuns, setHeldNextRuns] = useState<Record<string, string | null>>({})
    const schedulesRefreshKey = useBoardStore(state => state.schedulesRefreshKey)
    const workingSessions = useBoardStore(state =>
        state.sessions
            .filter(session => session.status === 'working' && (!agentId || session.agentId === agentId))
            .map(session => session.id)
            .sort()
            .join(',')
    )
    const now = useNow(30_000)
    const [reloadKey, setReloadKey] = useState(0)
    const seenSessions = useRef(workingSessions)
    const settledAt = useRef(0)

    useEffect(() => {
        // Only a run that just started has to settle: a routine saved or deleted is read at once.
        if (seenSessions.current !== workingSessions) {
            seenSessions.current = workingSessions
            settledAt.current = Date.now() + RUN_SETTLE_MS
        }
        if (!enabled) return
        let cancelled = false
        const fetchRoutines = () =>
            load()
                .then(next => !cancelled && setData(current => next ?? current ?? NO_ROUTINES))
                .catch(() => !cancelled && setData(current => current ?? NO_ROUTINES))
        const timer = setTimeout(fetchRoutines, Math.max(0, settledAt.current - Date.now()))
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [enabled, load, workingSessions, schedulesRefreshKey, reloadKey])

    const routines = useMemo(() => {
        if (!data) return null
        const at = new Date(now)
        return data.routines.map(routine => {
            const key = routineKey(routine)
            const held = heldNextRuns[key]
            const stillHeld = key in heldNextRuns && (held === null || new Date(held).getTime() > now)
            return { ...routine, frequency: routineFrequency(routine, tAgent, locale), nextRunAt: stillHeld ? held : nextRunAt(routine, at) }
        })
    }, [data, now, heldNextRuns, locale, tAgent])

    const patch = (key: string, change: Partial<WorkspaceRoutine>) =>
        setData(current => current && { ...current, routines: current.routines.map(routine => (routineKey(routine) === key ? { ...routine, ...change } : routine)) })

    const toggle = async (routine: WorkspaceRoutine, enabled: boolean) => {
        const key = routineKey(routine)
        setHeldNextRuns(current => (key in current ? current : { ...current, [key]: routine.nextRunAt }))
        patch(key, { enabled })
        setSaving(current => [...current, key])
        const result = await updateScheduleAction(routine.agentId, routine.slug, { enabled })
        setSaving(current => current.filter(savingKey => savingKey !== key))
        if (result.success) {
            useBoardStore.getState().requestSchedulesRefresh()
            return
        }
        patch(key, { enabled: !enabled })
        toast.error(t(enabled ? 'resumeFailed' : 'pauseFailed', { name: routine.name }), { description: errorText(result) })
    }

    const rename = async (routine: WorkspaceRoutine, name: string) => {
        const key = routineKey(routine)
        setRenamingKey(null)
        patch(key, { name })
        const result = await updateScheduleAction(routine.agentId, routine.slug, { name })
        if (result.success) {
            useBoardStore.getState().requestSchedulesRefresh()
            return
        }
        patch(key, { name: routine.name })
        toast.error(t('renameFailed', { name: routine.name }), { description: errorText(result) })
    }

    const runNow = async (routine: WorkspaceRoutine) => {
        const result = await testScheduleAction(routine.agentId, routine.slug)
        if (!result.success || !result.runId) {
            toast.error(t('runFailed', { name: routine.name }), { description: errorText(result) })
            return
        }
        if (!result.sessionId) {
            toast.success(t('started', { name: routine.name }))
            return
        }
        const sessionId = await adoptRunSession(routine.agentId, result.sessionId, routine.name)
        onRunStarted(routine, sessionId, result.runId)
    }

    return {
        routines,
        canRename: data?.canRename ?? false,
        now,
        isSaving: (routine: WorkspaceRoutine) => saving.includes(routineKey(routine)),
        renamingKey,
        startRename: (routine: WorkspaceRoutine) => setRenamingKey(routineKey(routine)),
        cancelRename: () => setRenamingKey(null),
        toggle,
        rename,
        runNow,
        // After a change the rows cannot show on their own (a routine created or deleted): back to the skeleton until it is read again.
        reload: () => {
            setData(null)
            setReloadKey(key => key + 1)
        },
    }
}
