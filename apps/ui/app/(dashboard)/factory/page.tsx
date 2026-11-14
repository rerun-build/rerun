'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { readFactorySnapshotAction } from '@/app/api/_actions/factory.actions'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { FactoryInspector } from '@/components/factory/FactoryInspector'
import { FactoryTasks } from '@/components/factory/FactoryTasks'
import { FactoryWorld } from '@/components/factory/FactoryWorld'
import { sceneFromSnapshot } from '@/components/factory/from-snapshot'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'

const POLL_MS = 30_000
// The task column over the floor's right edge, open and collapsed to its rail: the floor fits beside it.
const COLUMN_PX = 380
const RAIL_PX = 12
const EMPTY_ENDED = { merged: 0, rejected: 0, blocked: 0, failed: 0, returned: 0 }

type Answer = Awaited<ReturnType<typeof readFactorySnapshotAction>>

// The live Factory. Without a picture yet (no answer, or the read refused) the sample loop plays.
export default function FactoryPage() {
    const [answer, setAnswer] = useState<Answer>(null)

    useEffect(() => {
        let alive = true
        const read = () => {
            readFactorySnapshotAction()
                .then(next => { if (alive && next) setAnswer(next) })
                .catch(() => {})
        }
        read()
        const id = setInterval(read, POLL_MS)
        return () => {
            alive = false
            clearInterval(id)
        }
    }, [])

    const snapshot = answer?.snapshot
    const scene = useCallback((_: number, now: number) => sceneFromSnapshot(snapshot!, now), [snapshot])
    const { workspace } = useSession()

    const [selected, setSelected] = useState<number | null>(null)
    const [tab, setTab] = useState<'tasks' | 'inspect'>('tasks')
    const [collapsed, setCollapsed] = useState(false)

    // The board's agents are loaded by the board page only; here they are loaded once when missing.
    const hydrated = useBoardStore(s => s.hydrated)
    const hydrate = useBoardStore(s => s.hydrate)
    const agents = useBoardStore(s => s.agents)
    const hydratedWorkspaceId = useRef<number | null>(null)
    useEffect(() => {
        if (hydrated || !workspace) return
        if (hydratedWorkspaceId.current === workspace.id) return
        hydratedWorkspaceId.current = workspace.id
        hydrate(workspace.id)
    }, [hydrated, workspace, hydrate])

    const onSelect = useCallback((issue: number) => { setSelected(issue); setTab('inspect') }, [])
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const coworkers = useMemo(() => snapshot?.pools.flatMap(p => p.coworkers) ?? [], [snapshot])
    const names = useMemo(() => Object.fromEntries(coworkers.flatMap(c => (c.id ? [[c.id, c.name]] : []))), [coworkers])
    const openCoworker = useCallback((id: string) => useBoardStore.getState().focusAgentOnBoard(id, 'logs'), [])
    const openByName = useCallback((name: string) => {
        const id = coworkers.find(c => c.name === name)?.id
        if (id) openCoworker(id)
    }, [coworkers, openCoworker])

    const boss = agents.find(a => [a.handle, a.name].some(n => n?.toLowerCase() === 'boss'))
    const job = snapshot?.jobs.find(j => j.issue === selected) ?? null
    const tabButton = (id: 'tasks' | 'inspect', label: string) => (
        <button type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
            className={`rounded px-2 py-1 text-xs ${tab === id ? 'bg-accent font-medium' : 'text-muted-foreground'}`}>{label}</button>
    )

    return (
        <div className="relative">
            <FactoryWorld
                {...(snapshot ? { scene, selectedIssue: selected, onSelectJob: onSelect, onOpenCoworker: openByName } : {})}
                {...(workspace ? { workspace: String(workspace.id) } : {})}
                rightInset={collapsed ? RAIL_PX : COLUMN_PX}
            />
            <div className="absolute left-4 top-4">
                <button type="button" disabled={!boss} title={boss ? 'Open the chat with Boss' : 'No coworker named boss in this workspace'}
                    onClick={() => boss && useBoardStore.getState().focusAgentOnBoard(boss.id, 'chat')}
                    className="rounded-lg border border-border/60 bg-background/75 px-3 py-1.5 text-sm backdrop-blur-xl enabled:hover:bg-accent disabled:opacity-50">
                    Talk to Boss
                </button>
            </div>
            {collapsed ? (
                <button type="button" data-rail aria-label="Open the task column" onClick={() => setCollapsed(false)}
                    style={{ width: RAIL_PX }} className="absolute inset-y-0 right-0 border-l border-border/60 bg-background/75 backdrop-blur-xl hover:bg-accent" />
            ) : (
                <aside data-column style={{ width: COLUMN_PX }} className="absolute inset-y-0 right-0 flex flex-col border-l border-border/60 bg-background/85 backdrop-blur-xl">
                    <div className="flex items-center gap-1 border-b border-border/60 p-2">
                        {tabButton('tasks', 'Tasks')}
                        {tabButton('inspect', 'Inspect')}
                        <button type="button" data-collapse aria-label="Collapse the column" onClick={() => setCollapsed(true)}
                            className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">»</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {tab === 'tasks'
                            ? <FactoryTasks jobs={snapshot?.jobs ?? []} repo={snapshot?.repo ?? ''} endedToday={snapshot?.endedToday ?? EMPTY_ENDED} selected={selected} onSelect={onSelect} sample={!snapshot} />
                            : <FactoryInspector job={job} jobs={snapshot?.jobs ?? []} repo={snapshot?.repo ?? ''} names={names} onSelect={onSelect} onOpenCoworker={openCoworker} />}
                    </div>
                </aside>
            )}
            <AgentPanel />
        </div>
    )
}
