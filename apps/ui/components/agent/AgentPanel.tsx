'use client'

import { AgentLockedOverlay } from '@/components/agent/AgentLockedOverlay'
import { AgentPanelChat } from '@/components/agent/AgentPanelChat'
import { AgentCard, CardDestinationGhost, type CardOpenHandler } from '@/components/agent/sheet/AgentCard'
import type { ChatsFilter } from '@/components/agent/sheet/AgentChatsList'
import { AgentView } from '@/components/agent/sheet/AgentView'
import { AgentViewExpander, type CardOrigin, measureCardOrigin } from '@/components/agent/sheet/AgentViewExpander'
import { FloatingPill, FloatingSurface, Scrim, TopVeil } from '@/components/agent/sheet/floating'
import { ShareAgentDialog } from '@/components/agent/share/ShareAgentDialog'
import { AgentDesktopView } from '@/components/desktop/AgentDesktopView'
import { DeleteAgentDialog } from '@/components/dialogs/DeleteAgentDialog'
import { useComputerEnabled } from '@/components/layout/FeatureFlagsProvider'
import { SidePanel } from '@/components/layout/SidePanel'
import { Button } from '@/components/ui/button'
import { useAgentBuddyMood } from '@/hooks/useAgentBuddyMood'
import { useConnectorServices } from '@/hooks/useConnectorServices'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { isAgentViewTab, type AgentViewTab } from '@/lib/board/agent-sheet-views'
import { ATTENTION_STATUSES } from '@/lib/board/attention'
import { ChevronDownIcon, MessageCircle, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBoardStore } from '@/stores/board.store'
import { useDesktopStore } from '@/stores/desktop.store'
import { BorderBeam } from '@rerun/ui'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { AnimatePresence } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'

const KEEP_ALIVE_PANELS = 3

function trimOpenedAgents(ids: string[], busy: Set<string>): string[] {
    const kept = [...ids]
    for (let i = 0; kept.length > KEEP_ALIVE_PANELS && i < kept.length - 1; ) {
        if (busy.has(kept[i])) i++
        else kept.splice(i, 1)
    }
    return kept
}

type Surface = { kind: 'card'; entered?: CardOrigin } | { kind: 'chats'; filter: ChatsFilter }

export function AgentPanel() {
    const t = useTranslations('agent')
    const agents = useBoardStore(s => s.agents)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const selectAgent = useBoardStore(s => s.selectAgent)
    const sessions = useBoardStore(s => s.sessions)
    const agentFocusRequest = useBoardStore(s => s.agentFocusRequest)
    const clearAgentFocus = useBoardStore(s => s.clearAgentFocus)
    const agentFileFocus = useBoardStore(s => s.agentFileFocus)
    const agentDataFocus = useBoardStore(s => s.agentDataFocus)
    const desktopEnabled = useComputerEnabled()
    const openDesktop = useDesktopStore(s => s.openDesktop)
    const { access, needsMachineReason } = useWorkspaceAccess()
    const workspacePaused = access !== 'live'
    const agent = agents.find(a => a.id === selectedAgentId)
    const buddyMood = useAgentBuddyMood(selectedAgentId)
    const servicesNeedConfig = useConnectorServices(selectedAgentId ?? undefined).needsConfig
    const [surface, setSurface] = useState<Surface | null>(null)
    const [viewTab, setViewTab] = useState<AgentViewTab | null>(null)
    const [grownFrom, setGrownFrom] = useState<CardOrigin | null>(null)
    const [openedAgentIds, setOpenedAgentIds] = useState<string[]>([])
    const [pendingOpenSession, setPendingOpenSession] = useState<{ sessionId: string; title: string; runId: string | null } | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [shareOpen, setShareOpen] = useState(false)
    const displayedTab: AgentViewTab | null = agentFileFocus?.agentId === selectedAgentId ? 'files' : agentDataFocus?.agentId === selectedAgentId ? 'data' : viewTab

    const attentionCount = useMemo(() => sessions.filter(s => s.agentId === selectedAgentId && ATTENTION_STATUSES.has(s.status)).length, [sessions, selectedAgentId])
    const working = useMemo(() => sessions.some(s => s.agentId === selectedAgentId && s.status === 'working'), [sessions, selectedAgentId])

    useEffect(() => {
        if (!selectedAgentId) return
        setOpenedAgentIds(prev => {
            if (prev[prev.length - 1] === selectedAgentId) return prev
            const busy = new Set(useBoardStore.getState().sessions.filter(s => s.status === 'working').map(s => s.agentId))
            return trimOpenedAgents([...prev.filter(id => id !== selectedAgentId), selectedAgentId], busy)
        })
    }, [selectedAgentId])

    useEffect(() => {
        const agentIds = new Set(agents.map(a => a.id))
        setOpenedAgentIds(prev => {
            const filtered = prev.filter(id => agentIds.has(id))
            return filtered.length === prev.length ? prev : filtered
        })
    }, [agents])

    useEffect(() => {
        setSurface(null)
        setViewTab(null)
    }, [selectedAgentId])

    useEffect(() => {
        if (agentFileFocus?.agentId === selectedAgentId) setViewTab('files')
        else if (agentDataFocus?.agentId === selectedAgentId) setViewTab('data')
        else return
        setSurface(null)
    }, [agentFileFocus, agentDataFocus, selectedAgentId])

    useEffect(() => {
        if (!agentFocusRequest) return
        const tab = agentFocusRequest.tab
        if (isAgentViewTab(tab)) {
            setViewTab(tab)
            setSurface(null)
        } else {
            setViewTab(null)
            setSurface(tab === 'actions' ? { kind: 'chats', filter: 'needs' } : null)
        }
        clearAgentFocus()
    }, [agentFocusRequest, clearAgentFocus])

    const isOpen = !!selectedAgentId
    const closePanel = useCallback(() => selectAgent(null), [selectAgent])

    const openView: CardOpenHandler = (tab, from, shape) => {
        setSurface({ kind: 'card', entered: measureCardOrigin(tab, shape, from) })
        setViewTab(tab)
    }

    const backToCard = () => {
        setViewTab(null)
        setSurface({ kind: 'card' })
    }

    const openSession = (sessionId: string, title: string, runId: string | null) => {
        setPendingOpenSession({ sessionId, title, runId })
        setViewTab(null)
    }

    const openComputer = (agentId: string) => {
        setSurface(null)
        openDesktop(agentId)
    }

    const toggleSurface = (next: Surface) => setSurface(current => (current?.kind === next.kind ? null : next))

    const locked = !!agent && (workspacePaused || (!!agent.disabledAt && displayedTab !== 'settings'))
    const shownSurface = surface?.kind === 'chats' && locked ? null : surface
    const enteredFrom = displayedTab && shownSurface?.kind === 'card' ? shownSurface.entered : undefined
    const threadShown = !displayedTab || !!enteredFrom
    const covered = !!enteredFrom && grownFrom === enteredFrom

    const screen = agent && displayedTab && (
        <AgentView
            agent={agent}
            tab={displayedTab}
            onTabChange={setViewTab}
            onBack={backToCard}
            onClose={closePanel}
            onOpenSession={openSession}
            overlay={locked && <AgentLockedOverlay agent={agent} />}
        />
    )

    return (
        <SidePanel isOpen={isOpen} onDismiss={closePanel}>
            {agent && (
                <>
                    <DeleteAgentDialog agentId={agent.id} agentName={agent.name} open={deleteOpen} onOpenChange={setDeleteOpen} />
                    <ShareAgentDialog agentId={agent.id} agentName={agent.name} open={shareOpen} onOpenChange={setShareOpen} />
                </>
            )}
            <AgentDesktopView />
            {openedAgentIds.map(id => (
                <div key={id} className={threadShown && selectedAgentId === id ? cn('absolute inset-0 flex flex-col', covered && 'invisible') : 'hidden'}>
                    <AgentPanelChat
                        agentId={id}
                        agentName={agents.find(a => a.id === id)?.name ?? t('panelsShared.yourCoworker')}
                        selected={selectedAgentId === id && !displayedTab && !locked}
                        openSessionRequest={selectedAgentId === id ? pendingOpenSession : null}
                        onOpenSessionConsumed={() => setPendingOpenSession(null)}
                        chats={selectedAgentId === id && shownSurface?.kind === 'chats' ? shownSurface.filter : null}
                        onCloseChats={() => setSurface(null)}
                    />
                </div>
            ))}
            {screen && !enteredFrom && <div className="absolute inset-0 flex flex-col">{screen}</div>}

            {agent && locked && !displayedTab && (
                <div className="absolute inset-0 z-10 flex flex-col bg-background pt-16">
                    <AgentLockedOverlay agent={agent} />
                </div>
            )}

            {agent && threadShown && !covered && (
                <>
                    <TopVeil tall={!locked} />
                    {!locked && (
                        <div className="absolute left-3 top-3 z-50">
                            <FloatingPill label={t('agentPanel.threads')} onClick={() => toggleSurface({ kind: 'chats', filter: 'all' })} active={shownSurface?.kind === 'chats'} className="w-10 justify-center px-0">
                                <span className="relative flex">
                                    <MessageCircle className="size-4 text-muted-foreground" />
                                    {attentionCount > 0 && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-red-500 ring-2 ring-background" />}
                                </span>
                            </FloatingPill>
                        </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-16 top-3 z-50 flex justify-center">
                        <FloatingPill label={t('agentPanel.coworkerCard')} onClick={() => toggleSurface({ kind: 'card' })} active={shownSurface?.kind === 'card'} className="pointer-events-auto relative min-w-0 pl-1.5">
                            <BorderBeam pattern="arcs" tone="neutral" angle={243} outset={1} className="opacity-50" />
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                                <AgentBuddy agentId={agent.id} mood={buddyMood} size={20} facing="right" />
                            </span>
                            <span className="truncate font-medium">{agent.name}</span>
                            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        </FloatingPill>
                    </div>
                    <div className="absolute right-3 top-3 z-50">
                        <Button aria-label={t('panelsShared.closePanel')} variant="ghost" size="icon-sm" onClick={closePanel} className="bg-background/85 backdrop-blur-xl">
                            <XIcon className="size-4" />
                        </Button>
                    </div>
                </>
            )}

            <AnimatePresence>
                {agent && threadShown && !covered && shownSurface && <Scrim key="scrim" onClose={() => setSurface(null)} />}
                {agent && threadShown && shownSurface?.kind === 'card' && (
                    <FloatingSurface key="card" receded={!!enteredFrom} className={cn('inset-x-3 top-16 max-h-[calc(100%-5rem)] md:inset-x-5', covered && 'invisible')}>
                        <AgentCard
                            agent={agent}
                            onOpen={openView}
                            onClose={() => setSurface(null)}
                            onShare={() => setShareOpen(true)}
                            onDelete={() => setDeleteOpen(true)}
                            onOpenComputer={() => openComputer(agent.id)}
                            computerEnabled={desktopEnabled}
                            working={working}
                            servicesNeedConfig={servicesNeedConfig}
                            needsMachineReason={needsMachineReason}
                        />
                    </FloatingSurface>
                )}
                {screen && enteredFrom && (
                    <AgentViewExpander key="screen" origin={enteredFrom} onGrown={() => setGrownFrom(enteredFrom)} ghost={<CardDestinationGhost tab={enteredFrom.tab} shape={enteredFrom.shape} />}>
                        {screen}
                    </AgentViewExpander>
                )}
            </AnimatePresence>
        </SidePanel>
    )
}
