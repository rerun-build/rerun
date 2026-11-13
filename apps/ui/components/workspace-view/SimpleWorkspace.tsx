'use client'

import { byRecency } from '@rerun/contracts'
import { Stripes } from '@rerun/ui/primitives'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatsFilter } from '@/components/agent/sheet/AgentChatsList'
import { ShareAgentDialog } from '@/components/agent/share/ShareAgentDialog'
import { AgentDesktopView } from '@/components/desktop/AgentDesktopView'
import { DeleteAgentDialog } from '@/components/dialogs/DeleteAgentDialog'
import type { CoworkerTileActions } from '@/components/workspace-view/CoworkerTile'
import { SimpleChatPane } from '@/components/workspace-view/SimpleChatPane'
import { SimpleDetailsPane } from '@/components/workspace-view/SimpleDetailsPane'
import { SimpleSidebar } from '@/components/workspace-view/SimpleSidebar'
import { useDetailsBesideChat, useDetailsOpen } from '@/components/workspace-view/useDetailsOpen'
import { useForemanInCenter } from '@/components/workspace-view/useForemanInCenter'
import { useAgentSheetView, type AgentSheetRequest } from '@/hooks/useAgentSheetView'
import { useBoxViewer } from '@/hooks/useBoxAccess'
import { cn } from '@/lib/utils'
import { FOREMAN_OPENED, initialOpenOf } from '@/lib/workspace-view'
import { useBoardStore } from '@/stores/board.store'
import { useCoworkerPreviewsStore } from '@/stores/coworker-previews.store'
import { useSimpleDetailsStore } from '@/stores/simple-details.store'
import { selectForemanVisible, useForemanStore } from '@/stores/foreman.store'
import { useSession } from '@/supabase/session/SessionProvider'

const lastOpenedKey = (workspaceId: number) => `rerun:simple-view-coworker:${workspaceId}`

function readLastOpened(workspaceId: number): string | null {
    try {
        return localStorage.getItem(lastOpenedKey(workspaceId))
    } catch {
        return null
    }
}

function rememberLastOpened(workspaceId: number, agentId: string) {
    try {
        localStorage.setItem(lastOpenedKey(workspaceId), agentId)
    } catch {}
}

// The most recently active coworker, for the place of one deleted while open.
function mostRecentCoworker(): string | null {
    const { agents } = useBoardStore.getState()
    const previews = useCoworkerPreviewsStore.getState().byAgent
    return [...agents].map(agent => ({ id: agent.id, latest: previews[agent.id] ?? null })).sort(byRecency)[0]?.id ?? null
}

/**
 * The Simple view: the coworkers listed on the left, the open one's chat in the middle, its card on
 * the right. It reads and
 * writes the same state as the 3D board (the selected coworker, its tabs), so switching between the two
 * keeps the conversation that was open.
 */
export function SimpleWorkspace() {
    const { workspace } = useSession()
    const workspaceId = workspace?.id
    const selectedAgentId = useBoardStore(s => s.selectedAgentId)
    const agents = useBoardStore(s => s.agents)
    const previewsLoaded = useCoworkerPreviewsStore(s => s.loaded)
    // The list of conversations floating over the chat belongs to one coworker: another one opens on its thread.
    const [chatsOf, setChatsOf] = useState<{ agentId: string; filter: ChatsFilter } | null>(null)
    const chats = chatsOf && chatsOf.agentId === selectedAgentId ? chatsOf.filter : null
    const [newThreadFor, setNewThreadFor] = useState<string | null>(null)
    const [openSessionRequest, setOpenSessionRequest] = useState<{ sessionId: string; title: string; runId: string | null } | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [shareOpen, setShareOpen] = useState(false)
    const besideChat = useDetailsBesideChat()
    const detailsOpen = useDetailsOpen()
    const setDetailsWanted = useSimpleDetailsStore(s => s.setWanted)
    const agent = agents.find(a => a.id === selectedAgentId)
    useEffect(() => () => useSimpleDetailsStore.getState().setWanted(null), [])

    // A link, a notification or the search asks for a coworker on a precise place: a screen opens the
    // card's column on it, the list of what waits on the person floats over the chat.
    const handleRequest = useCallback((request: AgentSheetRequest) => {
        const agentId = useBoardStore.getState().selectedAgentId
        if (request.kind === 'screen') useSimpleDetailsStore.getState().setWanted(true)
        else if (request.kind === 'chats' && agentId) setChatsOf({ agentId, filter: request.filter })
    }, [])
    const { displayedTab, setViewTab } = useAgentSheetView(handleRequest)

    const foremanVisible = useForemanStore(selectForemanVisible)
    const viewer = useBoxViewer()
    const foremanInCenter = useForemanInCenter()

    // Once per workspace: what was open last on this device (`initialOpenOf`). A coworker a link already
    // opened stays, and so does the Chief of Staff when it was just asked something. Its column being
    // open says nothing: on a desktop it is until someone closes it.
    const [restoredFor, setRestoredFor] = useState<number | null>(null)
    useEffect(() => {
        if (!workspaceId || !previewsLoaded || restoredFor === workspaceId) return
        setRestoredFor(workspaceId)
        const foreman = useForemanStore.getState()
        if (useBoardStore.getState().selectedAgentId || foreman.pendingPrompt !== null || foreman.activity !== 'idle') return
        const initial = initialOpenOf({ remembered: readLastOpened(workspaceId), agentIds: useBoardStore.getState().agents.map(a => a.id), foremanVisible, mostRecent: mostRecentCoworker() })
        if (initial?.kind === 'coworker') useBoardStore.getState().selectAgent(initial.agentId)
        else if (initial?.kind === 'foreman') foreman.openInCenter()
    }, [workspaceId, previewsLoaded, restoredFor, foremanVisible])
    const settled = !!workspaceId && restoredFor === workspaceId

    // Mounted the first time it opens, then kept: opening it again only slides it in. Open with the
    // page, it is simply there.
    const [details, setDetails] = useState({ mounted: false, slideIn: false })
    if (agent && detailsOpen && !details.mounted) setDetails({ mounted: true, slideIn: settled })

    // Written only once the workspace has been restored: before that, the Chief of Staff's column open
    // by default would replace what is about to be read.
    useEffect(() => {
        if (!workspaceId || restoredFor !== workspaceId) return
        if (foremanInCenter) rememberLastOpened(workspaceId, FOREMAN_OPENED)
        else if (selectedAgentId && agents.some(a => a.id === selectedAgentId)) rememberLastOpened(workspaceId, selectedAgentId)
    }, [workspaceId, restoredFor, selectedAgentId, agents, foremanInCenter])

    // The open coworker was deleted: the next one takes its place rather than an empty middle. Only
    // one the list had: a coworker just created is selected before realtime brings its row.
    const listedIds = useRef<Set<string>>(new Set())
    useEffect(() => {
        const listed = new Set(agents.map(a => a.id))
        const deleted = !!selectedAgentId && listedIds.current.has(selectedAgentId) && !listed.has(selectedAgentId)
        listedIds.current = listed
        if (workspaceId && deleted) useBoardStore.getState().selectAgent(mostRecentCoworker())
    }, [workspaceId, selectedAgentId, agents])

    const openCoworker = useCallback((agentId: string) => useBoardStore.getState().selectAgent(agentId), [])

    const actionsFor = useCallback(
        (agentId: string): CoworkerTileActions => ({
            onNewConversation: () => {
                openCoworker(agentId)
                setNewThreadFor(agentId)
            },
            onAllConversations: () => {
                openCoworker(agentId)
                setChatsOf({ agentId, filter: 'all' })
            },
            onOpenCard: () => {
                openCoworker(agentId)
                useSimpleDetailsStore.getState().setWanted(true)
            },
            onDuplicate: () => {
                const agent = useBoardStore.getState().agents.find(a => a.id === agentId)
                if (agent) useBoardStore.getState().requestCreation({ kind: 'duplicate', agentId, agentName: agent.name, spaceId: agent.spaceId }, viewer)
            },
            onMoveToBox: spaceId => useBoardStore.getState().moveAgentToBox(agentId, spaceId, viewer),
        }),
        [openCoworker, viewer]
    )

    const consumeNewThread = useCallback(() => setNewThreadFor(null), [])
    const consumeOpenSession = useCallback(() => setOpenSessionRequest(null), [])
    const changeChats = useCallback((filter: ChatsFilter | null) => setChatsOf(filter && selectedAgentId ? { agentId: selectedAgentId, filter } : null), [selectedAgentId])

    return (
        <div className="relative flex h-full min-h-0 w-full overflow-hidden">
            {workspace?.is_sandbox && <Stripes fade="edges" edgeWidth={104} color="rgb(245 158 11 / 0.16)" />}
            {/* Its widths are the list's track in BoardChatSplit, where the Chief of Staff takes the rest. */}
            {/* With the Chief of Staff in the middle the card is the list's width: its own edge is the line. */}
            <div className={cn('relative h-full w-72 shrink-0 bg-sidebar', !foremanInCenter && 'border-r border-border')}>
                <SimpleSidebar onOpenCoworker={openCoworker} actionsFor={actionsFor} />
            </div>
            {/* Hidden rather than unmounted while the Chief of Staff has the middle: a reply streaming keeps going. */}
            <div className={foremanInCenter ? 'hidden' : 'contents'}>
                <SimpleChatPane
                    chats={chats}
                    onChatsChange={changeChats}
                    newThreadFor={newThreadFor}
                    onNewThreadConsumed={consumeNewThread}
                    openSessionRequest={openSessionRequest}
                    onOpenSessionConsumed={consumeOpenSession}
                    settling={!settled}
                />
            </div>
            {agent && details.mounted && (
                <SimpleDetailsPane
                    agent={agent}
                    open={detailsOpen}
                    slideIn={details.slideIn}
                    screen={displayedTab}
                    onScreenChange={setViewTab}
                    onClose={() => setDetailsWanted(false)}
                    onOpenSession={(sessionId, title, runId) => {
                        setOpenSessionRequest({ sessionId, title, runId })
                        setViewTab(null)
                        if (!besideChat) setDetailsWanted(false)
                    }}
                    onShare={() => setShareOpen(true)}
                    onDelete={() => setDeleteOpen(true)}
                />
            )}
            {agent && (
                <>
                    <DeleteAgentDialog agentId={agent.id} agentName={agent.name} open={deleteOpen} onOpenChange={setDeleteOpen} />
                    <ShareAgentDialog agentId={agent.id} agentName={agent.name} open={shareOpen} onOpenChange={setShareOpen} />
                </>
            )}
            <AgentDesktopView />
        </div>
    )
}
