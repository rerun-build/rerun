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
import { useOpenedAgents } from '@/hooks/useOpenedAgents'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { useAgentSheetView } from '@/hooks/useAgentSheetView'
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

// What floats over the chat, one at a time: the coworker's card, or its list of threads.
// `entered` is the card's button a screen grew out of, while that screen is open over the card.
type Surface = { kind: 'card'; entered?: CardOrigin } | { kind: 'chats'; filter: ChatsFilter }

/**
 * At rest the panel is the chat and nothing else: the list of conversations on the left, the
 * coworker's name in the middle, the close button on the right. The name opens the card, and a
 * destination picked on the card grows out of its button to fill the panel, the card receding
 * behind it; the way back folds the screen into that button. A screen opened by a link has no
 * button to grow from: it takes the thread's place at once.
 */
export function AgentPanel() {
    const t = useTranslations('agent')
    const agents = useBoardStore(s => s.agents)
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const selectAgent = useBoardStore(s => s.selectAgent)
    const sessions = useBoardStore(s => s.sessions)
    const desktopEnabled = useComputerEnabled()
    const openDesktop = useDesktopStore(s => s.openDesktop)
    const { access, needsMachineReason } = useWorkspaceAccess()
    const workspacePaused = access !== 'live'
    const agent = agents.find(a => a.id === selectedAgentId)
    const buddyMood = useAgentBuddyMood(selectedAgentId)
    const servicesNeedConfig = useConnectorServices(selectedAgentId ?? undefined).needsConfig
    const [surface, setSurface] = useState<Surface | null>(null)
    // Declared before the screen's own effects: a link landing with a new coworker opens its list on
    // top of this reset, not under it.
    useEffect(() => {
        setSurface(null)
    }, [selectedAgentId])
    const { setViewTab, displayedTab } = useAgentSheetView(request => setSurface(request.kind === 'chats' ? { kind: 'chats', filter: request.filter } : null))
    const [grownFrom, setGrownFrom] = useState<CardOrigin | null>(null)
    const openedAgentIds = useOpenedAgents()
    const [pendingOpenSession, setPendingOpenSession] = useState<{ sessionId: string; title: string; runId: string | null } | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [shareOpen, setShareOpen] = useState(false)

    const attentionCount = useMemo(() => sessions.filter(s => s.agentId === selectedAgentId && ATTENTION_STATUSES.has(s.status)).length, [sessions, selectedAgentId])
    const working = useMemo(() => sessions.some(s => s.agentId === selectedAgentId && s.status === 'working'), [sessions, selectedAgentId])

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

    // Un agent éteint n'a rien à montrer : son fil et ses écrans décriraient un agent qui tourne.
    // La pilule du nom passe au-dessus du voile, donc Settings et la suppression restent accessibles
    // pour libérer un slot. Sauf workspace en pause : sa machine est archivée, Settings n'a plus rien
    // à lire non plus.
    const locked = !!agent && (workspacePaused || (!!agent.disabledAt && displayedTab !== 'settings'))
    // A locked coworker has no conversations to list: the surface and its scrim stay down together.
    const shownSurface = surface?.kind === 'chats' && locked ? null : surface
    const enteredFrom = displayedTab && shownSurface?.kind === 'card' ? shownSurface.entered : undefined
    // A screen grown out of the card covers the thread, its pills and the card, all kept underneath
    // so they are already in place when it folds back.
    const threadShown = !displayedTab || !!enteredFrom
    // Once grown, nothing it covers is painted any more: blurred and faded layers under an opaque
    // screen ran a phone's GPU out of tiles, and Android Chrome left holes in the screen (RER-93).
    // The blurred ones (veil, pills, scrim) go, since a hidden backdrop-filter still paints in
    // Chromium; the thread and the card stay mounted, only hidden. The way back clears
    // `enteredFrom`, so they are all there again before the screen folds.
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
            {/* Les chats restent montés même quand la sheet est fermée (selectedAgentId null)
                ou qu'on regarde un écran — ne pas démonter pour préserver le stream. */}
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
