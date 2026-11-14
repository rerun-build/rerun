'use client'

import { getGeneralSessionAction, renameSessionAction } from '@/app/api/_actions/session.actions'
import { useAgentSetup } from '@/hooks/useAgentSetup'
import { useAgentThreads } from '@/hooks/useAgentThreads'
import { invalidateAgentSkillSummaries } from '@/hooks/useAgentSkillSummaries'
import { isGeneralTab, NEW_THREAD_TITLE, useSessionTabs } from '@/hooks/useSessionTabs'
import { installSessionTitle } from '@/lib/chat/install-marker'
import { useBoardStore } from '@/stores/board.store'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'
import { AnimatePresence } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AgentSheetChat } from '@/components/agent/AgentSheetChat'
import { AgentChatsList, type ChatsFilter } from '@/components/agent/sheet/AgentChatsList'
import { FloatingSurface } from '@/components/agent/sheet/floating'
import { OpenChatsTabs } from '@/components/agent/sheet/OpenChatsTabs'
import { useSessionRename } from '@/components/agent/sheet/SessionRename'
import { CloseRunningTabDialog } from '@/components/dialogs/CloseRunningTabDialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { ArrowRightIcon, MessageCircle, WrenchIcon } from '@/lib/icons'
import { isTypingTarget } from '@/lib/typing-target'
import { cn } from '@/lib/utils'

// Combien de conversations restent montées derrière celle qu'on lit. Un onglet gardé vivant garde
// tout son transcript dans le DOM, donc le coût d'un re-render du panneau grandit avec le nombre de
// conversations ouvertes depuis le chargement de la page.
const KEEP_ALIVE_TABS = 3

// L'onglet d'une conversation qui tourne possède son stream : il ne se démonte pas, même vieux.
function trimMountedTabs(uids: string[], busy: Set<string>): string[] {
    const kept = [...uids]
    for (let i = 0; kept.length > KEEP_ALIVE_TABS && i < kept.length - 1; ) {
        if (busy.has(kept[i])) i++
        else kept.splice(i, 1)
    }
    return kept
}

type AgentPanelChatProps = {
    agentId: string
    agentName: string
    // The coworker on screen and unlocked. Several stay mounted behind it: only this one shows its
    // tabs and answers the keyboard.
    selected: boolean
    openSessionRequest?: { sessionId: string; title: string; runId: string | null } | null
    onOpenSessionConsumed?: () => void
    // The list of this coworker's conversations, floating over the thread while it is open.
    chats: ChatsFilter | null
    onCloseChats: () => void
    // Docked only: the list opens from a button of the header, its dot lit while a conversation needs the person.
    onOpenChats?: () => void
    chatsAttention?: number
    // `floating`: the panel over the board, its tabs under the pills that float above the thread.
    // `docked`: a column of its own, its tabs a header in the flow, with `headerEnd` at their right.
    presentation?: 'floating' | 'docked'
    headerEnd?: ReactNode
    // Asked from outside the chat (a menu of the Simple view's list): a new conversation, once.
    newThreadRequest?: boolean
    onNewThreadConsumed?: () => void
}

export function AgentPanelChat({ agentId, agentName, selected, openSessionRequest, onOpenSessionConsumed, chats, onCloseChats, onOpenChats, chatsAttention = 0, presentation = 'floating', headerEnd, newThreadRequest = false, onNewThreadConsumed }: AgentPanelChatProps) {
    const t = useTranslations('agent.agentPanelChat')
    const tView = useTranslations('workspaceView.chat')
    const { tabs, activeIndex, createNew, selectTab, closeTab, openTab, updateTabByUid, updateTabTitle, setGeneralSessionId } = useSessionTabs(agentId)
    const { threads, refresh: refreshThreads } = useAgentThreads(agentId)

    // General's row exists once someone has spoken in it; until then its tab opens on nothing, and
    // the first message sent there creates it. A General opened after this read, by another tab or
    // a teammate, arrives through the sessions channel below.
    const [generalLookedUp, setGeneralLookedUp] = useState(false)
    useEffect(() => {
        let alive = true
        getGeneralSessionAction(agentId)
            .then(general => alive && general && setGeneralSessionId(general.id))
            .catch(() => {})
            .finally(() => alive && setGeneralLookedUp(true))
        return () => {
            alive = false
        }
    }, [agentId, setGeneralSessionId])
    const [pendingCloseIndex, setPendingCloseIndex] = useState<number | null>(null)
    // Read once per agent rather than per conversation tab: every tab shows the same gate, and it
    // is the engine that decides when the install is over.
    const setup = useAgentSetup(agentId)
    const refreshSetup = setup.refresh
    // A run can close the install and write skills: both are re-read once it is over.
    const handleRunFinished = useCallback(() => {
        refreshSetup()
        invalidateAgentSkillSummaries(agentId)
    }, [refreshSetup, agentId])

    // A conversation that just opened may be the install starting: re-read the agent so every other
    // tab learns it is under way, rather than offering to start it a second time.
    const setupStartable = setup.pending && !setup.sessionId
    const handleSessionCreated = useCallback(
        (uid: string, id: string) => {
            updateTabByUid(uid, id)
            if (setupStartable) refreshSetup()
        },
        [updateTabByUid, setupStartable, refreshSetup]
    )
    const openInstall = useCallback(
        (sessionId: string) => {
            openTab(sessionId, installSessionTitle(agentName))
            refreshSetup()
        },
        [openTab, agentName, refreshSetup]
    )

    const activeUid = tabs[activeIndex]?.uid

    // An install runs in a thread of its own, never in General: while it is due, General hands over
    // to a blank thread, where its gate stands.
    const installDue = setup.pending && !setup.skipped
    useEffect(() => {
        if (installDue && isGeneralTab(tabs[activeIndex])) createNew()
    }, [installDue, tabs, activeIndex, createNew])

    // Session de kickoff créée côté serveur juste après la création de l'agent : on ouvre son
    // onglet et on garde le run id sous la main pour que le chat se rattache au stream en cours.
    const pendingOpenSession = useBoardStore(s => s.pendingOpenSession)
    const clearPendingOpenSession = useBoardStore(s => s.clearPendingOpenSession)
    const [kickoffRun, setKickoffRun] = useState<{ sessionId: string; runId: string | null } | null>(null)
    // A conversation opened from outside the panel (notification, inbox, search) lands on its end,
    // even when its tab was already open and scrolled up. Counted per conversation so a tab's count
    // never moves unless it is the one being opened.
    const [arrivals, setArrivals] = useState<Record<string, number>>({})
    const arriveAt = useCallback((sessionId: string) => setArrivals(prev => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 })), [])

    useEffect(() => {
        if (!pendingOpenSession || pendingOpenSession.agentId !== agentId) return
        setKickoffRun({ sessionId: pendingOpenSession.sessionId, runId: pendingOpenSession.runId })
        arriveAt(pendingOpenSession.sessionId)
        openTab(pendingOpenSession.sessionId, pendingOpenSession.title ?? NEW_THREAD_TITLE)
        clearPendingOpenSession()
    }, [pendingOpenSession, agentId, openTab, clearPendingOpenSession, arriveAt])

    // Keep-alive: on garde montés les derniers onglets visités pour ne pas perdre le stream/état en
    // cours en changeant d'onglet. Un onglet n'est monté qu'une fois affiché (montage paresseux),
    // et rangé du plus ancien au plus récent, le plafond évacuant les plus vieux. Un onglet démonté
    // relit son transcript sur l'engine au retour.
    const [mountedUids, setMountedUids] = useState<string[]>(() => (activeUid ? [activeUid] : []))

    useEffect(() => {
        if (!activeUid) return
        const working = new Set(useBoardStore.getState().sessions.filter(s => s.status === 'working').map(s => s.id))
        const busy = new Set(tabs.filter(t => t.id && working.has(t.id)).map(t => t.uid))
        setMountedUids(prev => (prev[prev.length - 1] === activeUid ? prev : trimMountedTabs([...prev.filter(uid => uid !== activeUid), activeUid], busy)))
    }, [activeUid, tabs])

    // Oublier les onglets fermés pour libérer la mémoire.
    useEffect(() => {
        const live = new Set(tabs.map(t => t.uid))
        setMountedUids(prev => {
            const next = prev.filter(uid => live.has(uid))
            return next.length === prev.length ? prev : next
        })
    }, [tabs])

    const requestCloseTab = useCallback(
        (index: number) => {
            if (isGeneralTab(tabs[index])) return
            const sessionId = tabs[index]?.id
            const working = !!sessionId && useBoardStore.getState().sessions.some(s => s.id === sessionId && s.status === 'working')
            if (working) setPendingCloseIndex(index)
            else closeTab(index)
        },
        [tabs, closeTab]
    )

    // The tab takes the new title at once: the sessions channel brings it too, to every other client.
    const renameSession = useCallback(
        async (sessionId: string, title: string) => {
            const renamed = await renameSessionAction(sessionId, title)
            if (renamed) updateTabTitle(sessionId, title)
            return renamed
        },
        [updateTabTitle]
    )
    const tabRename = useSessionRename(renameSession)
    const tabRenameFailed = tabRename.rename?.status === 'error' && tabs.some(tab => tab.id === tabRename.rename?.id)

    useEffect(() => {
        if (!openSessionRequest) return
        if (openSessionRequest.runId) setKickoffRun({ sessionId: openSessionRequest.sessionId, runId: openSessionRequest.runId })
        arriveAt(openSessionRequest.sessionId)
        openTab(openSessionRequest.sessionId, openSessionRequest.title)
        onOpenSessionConsumed?.()
    }, [openSessionRequest, openTab, onOpenSessionConsumed, arriveAt])

    useEffect(() => {
        if (!newThreadRequest) return
        createNew()
        onNewThreadConsumed?.()
    }, [newThreadRequest, createNew, onNewThreadConsumed])

    // Cmd/Ctrl+K : nouvelle conversation. Cmd/Ctrl+Backspace : fermer l'onglet actif, hors d'un champ
    // où le raccourci efface le mot précédent.
    useEffect(() => {
        if (!selected) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
            if (e.key?.toLowerCase() === 'k') {
                e.preventDefault()
                createNew()
                return
            }
            if (e.key !== 'Backspace') return
            const target = e.target as HTMLElement | null
            if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
            e.preventDefault()
            requestCloseTab(activeIndex)
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [selected, createNew, requestCloseTab, activeIndex])

    // One channel on the coworker's sessions: a General opened elsewhere takes its pinned tab, a
    // title the hub generated reaches its tab, and the threads of General are read again.
    useRealtimeSubscription('sessions', {
        channelId: `sessions-title-${agentId}`,
        filter: { column: 'agent_id', value: agentId },
        onInsert: inserted => {
            if (inserted.kind === 'general') setGeneralSessionId(inserted.id)
            refreshThreads()
        },
        onUpdate: updated => {
            if (updated.title) {
                updateTabTitle(updated.id, updated.title)
            }
            refreshThreads()
        },
        onResync: refreshThreads,
    })

    const docked = presentation === 'docked'
    const openChatsTabs = <OpenChatsTabs tabs={tabs} activeIndex={activeIndex} onSelect={selectTab} onClose={requestCloseTab} onCreate={createNew} rename={tabRename} />
    // Closing sets `chats` to null while the popover is still fading out: its list stays on the last filter until it has left.
    const [lastChats, setLastChats] = useState(chats)
    if (chats && chats !== lastChats) setLastChats(chats)
    const listedChats = chats ?? lastChats
    const chatsList = listedChats && (
        <AgentChatsList
            key={listedChats}
            agentId={agentId}
            agentName={agentName}
            activeSessionId={tabs[activeIndex]?.id ?? null}
            initialFilter={listedChats}
            onSelect={(sessionId, title) => {
                openTab(sessionId, title)
                onCloseChats()
            }}
            onRename={renameSession}
            onCreateNew={() => {
                createNew()
                onCloseChats()
            }}
            onClose={onCloseChats}
        />
    )

    return (
        <div className={cn('flex flex-col h-full', docked && '[--chat-column:48rem]')}>
            {docked ? (
                <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border pr-2">
                    <div className="min-w-0 flex-1">{openChatsTabs}</div>
                    <Popover open={chats !== null} onOpenChange={open => (open ? onOpenChats?.() : onCloseChats())}>
                        <TooltipLabeled label={tView('allConversations')}>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label={tView('allConversations')} className={cn(chats && 'bg-accent')}>
                                    <span className="relative flex">
                                        <MessageCircle className="size-4" />
                                        {chatsAttention > 0 && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-red-500 ring-2 ring-background" />}
                                    </span>
                                </Button>
                            </PopoverTrigger>
                        </TooltipLabeled>
                        {/* A menu item or a dialog that opens the list hands the focus back to where it came from: only a click outside or Escape closes it. A field keeps its own Escape. */}
                        <PopoverContent
                            align="end"
                            onFocusOutside={event => event.preventDefault()}
                            onEscapeKeyDown={event => isTypingTarget(event.target) && event.preventDefault()}
                            className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(340px,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0"
                        >
                            {chatsList}
                        </PopoverContent>
                    </Popover>
                    {headerEnd}
                </div>
            ) : (
                <>
                    {/* Room for the pills that float over the top of the panel, and the open conversations under them. */}
                    <div className={cn('shrink-0', tabRenameFailed ? 'h-[7.25rem]' : 'h-24')} />
                    {selected && <div className="absolute inset-x-0 top-[3.75rem] z-20">{openChatsTabs}</div>}
                </>
            )}
            {/* Skipping hides the gate, not the fact that the agent still has nothing connected. */}
            {setup.pending && setup.skipped && (
                <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 py-1 pr-1.5 pl-3 text-xs text-muted-foreground">
                    <WrenchIcon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t('notSetUp')}</span>
                    <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                            setup.unskip()
                            // The gate only stands where a composer would, so it needs a conversation
                            // nobody has spoken in: coming back to the setup opens one.
                            if (tabs[activeIndex]?.id) createNew()
                        }}
                    >
                        {t('setUp')}
                        <ArrowRightIcon className="size-3" />
                    </Button>
                </div>
            )}
            {tabs.map((tab, index) => {
                if (!mountedUids.includes(tab.uid)) return null
                const active = index === activeIndex
                return (
                    <div key={tab.uid} className={active ? 'flex flex-1 flex-col overflow-hidden' : 'hidden'}>
                        <AgentSheetChat
                            uid={tab.uid}
                            active={active}
                            agentId={agentId}
                            sessionId={tab.id}
                            sessionPending={isGeneralTab(tab) && !tab.id && !generalLookedUp}
                            onSessionCreated={(id) => handleSessionCreated(tab.uid, id)}
                            initialRunId={tab.id && tab.id === kickoffRun?.sessionId ? kickoffRun.runId : null}
                            arrival={tab.id ? arrivals[tab.id] : undefined}
                            setup={isGeneralTab(tab) ? undefined : setup}
                            onSetupSkipped={setup.skip}
                            onOpenInstall={openInstall}
                            onRunFinished={handleRunFinished}
                            onNewConversation={createNew}
                            kind={tab.kind}
                            title={tab.title}
                            threads={isGeneralTab(tab) ? threads : undefined}
                            onOpenThread={openTab}
                        />
                    </div>
                )
            })}
            <AnimatePresence>
                {!docked && chats && (
                    <FloatingSurface key="chats" className="top-16 left-3 w-[min(340px,calc(100%-1.5rem))]">
                        {chatsList}
                    </FloatingSurface>
                )}
            </AnimatePresence>
            <CloseRunningTabDialog
                open={pendingCloseIndex !== null}
                onOpenChange={open => {
                    if (!open) setPendingCloseIndex(null)
                }}
                onConfirm={() => {
                    if (pendingCloseIndex !== null) closeTab(pendingCloseIndex)
                    setPendingCloseIndex(null)
                }}
            />
        </div>
    )
}
