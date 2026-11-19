'use client'

import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { readFactorySnapshotAction } from '@/app/api/_actions/factory.actions'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { ControlCenter } from '@/components/control-center/ControlCenter'
import { FactoryLoader } from '@/components/factory/FactoryLoader'
import { FactoryTopBar } from '@/components/factory/FactoryTopBar'
import { FactoryWorld } from '@/components/factory/FactoryWorld'
import { type Bucket } from '@/components/factory/factory-bucket'
import { LOADER_TILE } from '@/components/factory/factory-state'
import { sceneFromSnapshot } from '@/components/factory/from-snapshot'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { SIDE_PANEL_GAP, loadSidePanelWidth } from '@/lib/side-panel-width'
import { useBoardStore } from '@/stores/board.store'
import { useSession } from '@/supabase/session/SessionProvider'

const POLL_MS = 30_000
const LOADER_PANEL_PX = 380
const BREAKPOINT_PX = 768

type Answer = Awaited<ReturnType<typeof readFactorySnapshotAction>>

export function FactoryPage() {
    const { resolvedTheme } = useTheme()
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
    const [bucket, setBucket] = useState<Bucket | null>(null)
    const [loaderOpen, setLoaderOpen] = useState(false)

    const hydrated = useBoardStore(s => s.hydrated)
    const hydrate = useBoardStore(s => s.hydrate)
    const agents = useBoardStore(s => s.agents)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const [viewport, setViewport] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
    useEffect(() => {
        const onResize = () => setViewport(window.innerWidth)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])
    const hydratedWorkspaceId = useRef<number | null>(null)
    useEffect(() => {
        if (hydrated || !workspace) return
        if (hydratedWorkspaceId.current === workspace.id) return
        hydratedWorkspaceId.current = workspace.id
        hydrate(workspace.id)
    }, [hydrated, workspace, hydrate])

    const onSelect = useCallback((issue: number) => setSelected(issue), [])
    const onOpenBucket = useCallback((b: Bucket) => { setSelected(null); setBucket(b) }, [])
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSelected(null); setBucket(null) } }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const coworkers = useMemo(() => snapshot?.pools.flatMap(p => p.coworkers) ?? [], [snapshot])
    const names = useMemo(() => Object.fromEntries(coworkers.flatMap(c => (c.id ? [[c.id, c.name]] : []))), [coworkers])
    const openCoworker = useCallback((id: string) => {
        setLoaderOpen(false)
        useBoardStore.getState().focusAgentOnBoard(id, 'logs')
    }, [])
    const openByName = useCallback((name: string) => {
        if (name === LOADER_TILE) {
            useBoardStore.getState().selectAgent(null)
            setLoaderOpen(true)
            return
        }
        const id = coworkers.find(c => c.name === name)?.id
        if (id) openCoworker(id)
    }, [coworkers, openCoworker])

    const boss = agents.find(a => [a.handle, a.name].some(n => n?.toLowerCase() === 'boss'))
    const rightInset = viewport < BREAKPOINT_PX ? 0 : loaderOpen ? LOADER_PANEL_PX : selectedAgentId ? loadSidePanelWidth(viewport) + SIDE_PANEL_GAP : 0

    return (
        <div className="relative">
            <FactoryWorld
                {...(snapshot ? { scene, selectedIssue: selected, onSelectJob: onSelect, onOpenBucket, onOpenCoworker: openByName } : {})}
                {...(workspace ? { workspace: String(workspace.id) } : {})}
                snapshot={snapshot ?? null}
                rightInset={rightInset}
                theme={resolvedTheme === 'light' ? 'light' : 'dark'}
                topBar={<FactoryTopBar snapshot={snapshot ?? null} selected={selected} onSelect={setSelected} names={names} onOpenCoworker={openCoworker} bucket={bucket} onBucket={setBucket} />}
            />
            <WorkspaceSwitcher />
            <div className="absolute left-4 top-16 z-30">
                <button type="button" disabled={!boss} title={boss ? 'Open the chat with Boss' : 'No coworker named boss in this workspace'}
                    onClick={() => { if (!boss) return; setLoaderOpen(false); useBoardStore.getState().focusAgentOnBoard(boss.id, 'chat') }}
                    className="rounded-lg border border-border/60 bg-background/75 px-3 py-1.5 text-sm backdrop-blur-xl enabled:hover:bg-accent disabled:opacity-50">
                    Talk to Boss
                </button>
            </div>
            {loaderOpen && (
                <aside data-loader-panel style={{ width: LOADER_PANEL_PX }} className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-border/60 bg-background/95 backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-border/60 p-2">
                        <span className="px-2 text-xs font-medium">Loader</span>
                        <button type="button" data-loader-close aria-label="Close the Loader panel" onClick={() => setLoaderOpen(false)}
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">×</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto"><FactoryLoader snapshot={snapshot ?? null} /></div>
                </aside>
            )}
            <AgentPanel />
            <ControlCenter />
        </div>
    )
}
