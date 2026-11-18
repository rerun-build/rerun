'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { useTranslations } from 'next-intl'

import { listWorkspaceRoutinesAction, type WorkspaceRoutine } from '@/app/api/_actions/agent.actions'
import { EmptyState } from '@/components/ui/empty-state'
import { RoutineMenu } from '@/components/routines/RoutineMenu'
import { RoutinesSkeleton } from '@/components/routines/RoutinesSkeleton'
import { useRoutines } from '@/components/routines/useRoutines'
import { coversTheBoard } from '@/lib/foreman-open'
import { CalendarClockIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { RoutineList } from '@rerun/ui/foreman'

function leaveForTheBoard() {
    // En sheet, le Foreman couvre le board : le panneau de l'agent s'ouvrirait dessous.
    if (coversTheBoard()) useForemanStore.getState().close()
}

// A routine of the Chief of Staff's own is edited on its card: its Routines screen, on that routine.
function openEditor(routine: WorkspaceRoutine) {
    const board = useBoardStore.getState()
    if (routine.agentId === FOREMAN_AGENT_ID) {
        // Only the routine to land on: selecting it on the board would open a coworker's panel on nobody.
        useBoardStore.setState({ agentScheduleFocus: { agentId: routine.agentId, slug: routine.slug } })
        useForemanStore.getState().setCardScreen('scheduled')
        return
    }
    board.focusAgentOnBoard(routine.agentId, 'scheduled')
    board.openAgentSchedule(routine.agentId, routine.slug)
    leaveForTheBoard()
}

function openRun(routine: WorkspaceRoutine, sessionId: string, runId: string) {
    // Its run is read in its chat, where the thread shows up as soon as the engine announces it.
    if (routine.agentId === FOREMAN_AGENT_ID) {
        useForemanStore.getState().setTab('assistant')
        return
    }
    const board = useBoardStore.getState()
    board.focusAgentOnBoard(routine.agentId, 'chat')
    board.setPendingOpenSession({ agentId: routine.agentId, sessionId, runId, title: routine.name })
    leaveForTheBoard()
}

// `active`: false while the list is mounted out of sight, so it reads nothing until it shows again.
export function ForemanRoutines({ docked, active = true, className }: { docked: boolean; active?: boolean; className?: string }) {
    const t = useTranslations('foreman.routines')
    const foremanName = useTranslations('workspaceView.foreman')('name')
    const agents = useBoardStore(state => state.agents)
    const list = useRoutines({ load: listWorkspaceRoutinesAction, enabled: active, onRunStarted: openRun })

    if (!list.routines) {
        return <RoutinesSkeleton className={className} />
    }

    if (list.routines.length === 0) {
        return (
            <div className={cn('flex flex-col', className)}>
                <EmptyState icon={CalendarClockIcon} title={t('emptyTitle')} description={t('emptyDescription')} />
            </div>
        )
    }

    return (
        <RoutineList
            routines={list.routines}
            now={list.now}
            agentNameOf={agentId => (agentId === FOREMAN_AGENT_ID ? foremanName : (agents.find(agent => agent.id === agentId)?.name ?? t('unknownCoworker')))}
            onOpen={openEditor}
            onToggle={list.toggle}
            isSaving={list.isSaving}
            renamingKey={list.renamingKey}
            onRename={list.rename}
            onCancelRename={list.cancelRename}
            renderMenu={routine => <RoutineMenu routine={routine} canRename={list.canRename} onRename={() => list.startRename(routine)} onEdit={() => openEditor(routine)} onRunNow={() => list.runNow(routine)} />}
            docked={docked}
            className={className}
        />
    )
}
