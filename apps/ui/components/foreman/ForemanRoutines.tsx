'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { listWorkspaceRoutinesAction, testScheduleAction, updateScheduleAction, type WorkspaceRoutine, type WorkspaceRoutines } from '@/app/api/_actions/agent.actions'
import { adoptRunSession } from '@/components/agent/AgentRunHistory'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { coversTheBoard } from '@/lib/foreman-open'
import { CalendarClockIcon, EllipsisIcon } from '@/lib/icons'
import { nextRunAt, routineFrequency } from '@/lib/schedules/cron'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { RoutineList, routineKey } from '@rerun/ui/foreman'

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

function leaveForTheBoard() {
    // En sheet, le Foreman couvre le board : le panneau de l'agent s'ouvrirait dessous.
    if (coversTheBoard()) useForemanStore.getState().close()
}

export function ForemanRoutines({ docked, className }: { docked: boolean; className?: string }) {
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
    const agents = useBoardStore(state => state.agents)
    const schedulesRefreshKey = useBoardStore(state => state.schedulesRefreshKey)
    const workingSessions = useBoardStore(state =>
        state.sessions
            .filter(session => session.status === 'working')
            .map(session => session.id)
            .sort()
            .join(',')
    )
    const now = useNow(30_000)
    const loaded = useRef(false)

    useEffect(() => {
        let cancelled = false
        const load = () =>
            listWorkspaceRoutinesAction()
                .then(next => !cancelled && setData(next))
                .catch(() => !cancelled && setData(current => current ?? { routines: [], canRename: false }))
                .finally(() => (loaded.current = true))
        const timer = setTimeout(load, loaded.current ? RUN_SETTLE_MS : 0)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [workingSessions, schedulesRefreshKey])

    const upToDate = useMemo(() => {
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

    const openEditor = (routine: WorkspaceRoutine) => {
        const board = useBoardStore.getState()
        board.focusAgentOnBoard(routine.agentId, 'scheduled')
        board.openAgentSchedule(routine.agentId, routine.slug)
        leaveForTheBoard()
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
        const board = useBoardStore.getState()
        board.focusAgentOnBoard(routine.agentId, 'chat')
        board.setPendingOpenSession({ agentId: routine.agentId, sessionId, runId: result.runId, title: routine.name })
        leaveForTheBoard()
    }

    if (!upToDate || !data) {
        return <RoutinesSkeleton className={className} />
    }

    if (upToDate.length === 0) {
        return (
            <div className={cn('flex flex-col', className)}>
                <EmptyState icon={CalendarClockIcon} title={t('emptyTitle')} description={t('emptyDescription')} />
            </div>
        )
    }

    return (
        <RoutineList
            routines={upToDate}
            now={now}
            agentNameOf={agentId => agents.find(agent => agent.id === agentId)?.name ?? t('unknownCoworker')}
            onOpen={openEditor}
            onToggle={toggle}
            isSaving={routine => saving.includes(routineKey(routine))}
            renamingKey={renamingKey}
            onRename={rename}
            onCancelRename={() => setRenamingKey(null)}
            renderMenu={routine => <RoutineMenu routine={routine} canRename={data.canRename} onRename={() => setRenamingKey(routineKey(routine))} onEdit={() => openEditor(routine)} onRunNow={() => runNow(routine)} />}
            docked={docked}
            className={className}
        />
    )
}

type RoutineMenuProps = { routine: WorkspaceRoutine; canRename: boolean; onRename: () => void; onEdit: () => void; onRunNow: () => void }

function RoutineMenu({ routine, canRename, onRename, onEdit, onRunNow }: RoutineMenuProps) {
    const t = useTranslations('foreman.routines')
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={t('options', { name: routine.name })} className="text-muted-foreground">
                    <EllipsisIcon />
                </Button>
            </DropdownMenuTrigger>
            {/* The rename field takes the focus a beat later; the menu handing it back would steal it. */}
            <DropdownMenuContent align="end" onCloseAutoFocus={event => event.preventDefault()}>
                {canRename && <DropdownMenuItem onSelect={onRename}>{t('rename')}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={onEdit}>{t('edit')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={routine.setupPending && !routine.enabled} onSelect={onRunNow}>
                    {t('runNow')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

const SKELETON_GROUPS = [
    { heading: 'w-14', rows: 2 },
    { heading: 'w-20', rows: 3 },
]
const TITLE_WIDTHS = ['w-1/2', 'w-2/5', 'w-3/5', 'w-1/3', 'w-1/2']
const RULE_WIDTHS = ['w-3/5', 'w-1/2', 'w-2/3', 'w-2/5', 'w-1/2']

function RoutinesSkeleton({ className }: { className?: string }) {
    let rowIndex = 0
    return (
        <div className={cn('flex flex-col', className)}>
            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-4">
                {SKELETON_GROUPS.map((group, groupIndex) => (
                    <section key={groupIndex}>
                        <div className={cn('-mx-3 flex items-center px-4 pb-2.5', groupIndex === 0 ? 'pt-2' : 'pt-7')}>
                            <div className="flex h-6 items-center gap-2">
                                <Skeleton className={cn('h-4', group.heading)} />
                                <Skeleton className="h-3.5 w-3" />
                            </div>
                        </div>
                        <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border bg-muted/20">
                            {Array.from({ length: group.rows }).map(() => {
                                const i = rowIndex++
                                return (
                                    <div key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
                                        <Skeleton className="size-7 shrink-0 rounded-md" />
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <div className="flex h-5 items-center">
                                                <Skeleton className={cn('h-3.5', TITLE_WIDTHS[i % TITLE_WIDTHS.length])} />
                                            </div>
                                            <div className="flex h-4 items-center">
                                                <Skeleton className={cn('h-3', RULE_WIDTHS[i % RULE_WIDTHS.length])} />
                                            </div>
                                        </div>
                                        <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
                                        <Skeleton className="size-7 shrink-0 rounded-md" />
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    )
}
