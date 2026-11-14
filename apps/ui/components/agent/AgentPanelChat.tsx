'use client'

import { getGeneralSessionAction } from '@/app/api/_actions/session.actions'
import { useAgentSetup } from '@/hooks/useAgentSetup'
import { useAgentThreads } from '@/hooks/useAgentThreads'
import { invalidateAgentSkillSummaries } from '@/hooks/useAgentSkillSummaries'
import { isGeneralTab, NEW_THREAD_TITLE, useSessionTabs } from '@/hooks/useSessionTabs'
import { installSessionTitle } from '@/lib/chat/install-marker'
import { useBoardStore } from '@/stores/board.store'
import { useRealtimeSubscription } from '@/supabase/useRealtimeSubscription'
import { AnimatePresence } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { AgentSheetChat } from '@/components/agent/AgentSheetChat'
import { AgentChatsList, type ChatsFilter } from '@/components/agent/sheet/AgentChatsList'
import { FloatingSurface } from '@/components/agent/sheet/floating'
import { OpenChatsTabs } from '@/components/agent/sheet/OpenChatsTabs'
import { CloseRunningTabDialog } from '@/components/dialogs/CloseRunningTabDialog'
import { Button } from '@/components/ui/button'
import { ArrowRightIcon, WrenchIcon } from '@/lib/icons'

const KEEP_ALIVE_TABS = 3

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
    selected: boolean
    openSessionRequest?: { sessionId: string; title: string; runId: string | null } | null
    onOpenSessionConsumed?: () => void
    chats: ChatsFilter | null
    onCloseChats: () => void
}

export function AgentPanelChat({ agentId, agentName, selected, openSessionRequest, onOpenSessionConsumed, chats, onCloseChats }: AgentPanelChatProps) {
    const t = useTranslations('agent.agentPanelChat')
    const { tabs, activeIndex, createNew, selectTab, closeTab, openTab, updateTabByUid, updateTabTitle, setGeneralSessionId } = useSessionTabs(agentId)
    const { threads, refresh: refreshThreads } = useAgentThreads(agentId)

    useEffect(() => {
        let alive = true
        getGeneralSessionAction(agentId).then(general => alive && general && setGeneralSessionId(general.id)).catch(() => {})
        return () => {
            alive = false
        }
    }, [agentId, setGeneralSessionId])
    const [pendingCloseIndex, setPendingCloseIndex] = useState<number | null>(null)
    const setup = useAgentSetup(agentId)
    const refreshSetup = setup.refresh
    const handleRunFinished = useCallback(() => {
        refreshSetup()
        invalidateAgentSkillSummaries(agentId)
    }, [refreshSetup, agentId])

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

    const installDue = setup.pending && !setup.skipped
    useEffect(() => {
        if (installDue && isGeneralTab(tabs[activeIndex])) createNew()
    }, [installDue, tabs, activeIndex, createNew])

    const pendingOpenSession = useBoardStore(s => s.pendingOpenSession)
    const clearPendingOpenSession = useBoardStore(s => s.clearPendingOpenSession)
    const [kickoffRun, setKickoffRun] = useState<{ sessionId: string; runId: string | null } | null>(null)
    const [arrivals, setArrivals] = useState<Record<string, number>>({})
    const arriveAt = useCallback((sessionId: string) => setArrivals(prev => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 })), [])

    useEffect(() => {
        if (!pendingOpenSession || pendingOpenSession.agentId !== agentId) return
        setKickoffRun({ sessionId: pendingOpenSession.sessionId, runId: pendingOpenSession.runId })
        arriveAt(pendingOpenSession.sessionId)
        openTab(pendingOpenSession.sessionId, pendingOpenSession.title ?? NEW_THREAD_TITLE)
        clearPendingOpenSession()
    }, [pendingOpenSession, agentId, openTab, clearPendingOpenSession, arriveAt])

    const [mountedUids, setMountedUids] = useState<string[]>(() => (activeUid ? [activeUid] : []))

    useEffect(() => {
        if (!activeUid) return
        const working = new Set(useBoardStore.getState().sessions.filter(s => s.status === 'working').map(s => s.id))
        const busy = new Set(tabs.filter(t => t.id && working.has(t.id)).map(t => t.uid))
        setMountedUids(prev => (prev[prev.length - 1] === activeUid ? prev : trimMountedTabs([...prev.filter(uid => uid !== activeUid), activeUid], busy)))
    }, [activeUid, tabs])

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

    useEffect(() => {
        if (!openSessionRequest) return
        if (openSessionRequest.runId) setKickoffRun({ sessionId: openSessionRequest.sessionId, runId: openSessionRequest.runId })
        arriveAt(openSessionRequest.sessionId)
        openTab(openSessionRequest.sessionId, openSessionRequest.title)
        onOpenSessionConsumed?.()
    }, [openSessionRequest, openTab, onOpenSessionConsumed, arriveAt])

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

    return (
        <div className="flex flex-col h-full">
            <div className="h-24 shrink-0" />
            {selected && (
                <div className="absolute inset-x-0 top-[3.75rem] z-20">
                    <OpenChatsTabs tabs={tabs} activeIndex={activeIndex} onSelect={selectTab} onClose={requestCloseTab} onCreate={createNew} />
                </div>
            )}
            {setup.pending && setup.skipped && (
                <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 py-1 pr-1.5 pl-3 text-xs text-muted-foreground">
                    <WrenchIcon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t('notSetUp')}</span>
                    <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                            setup.unskip()
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
                {chats && (
                    <FloatingSurface key="chats" className="left-3 top-16 w-[min(340px,calc(100%-1.5rem))]">
                        <AgentChatsList
                            key={chats}
                            agentId={agentId}
                            agentName={agentName}
                            activeSessionId={tabs[activeIndex]?.id ?? null}
                            initialFilter={chats}
                            onSelect={(sessionId, title) => {
                                openTab(sessionId, title)
                                onCloseChats()
                            }}
                            onCreateNew={() => {
                                createNew()
                                onCloseChats()
                            }}
                            onClose={onCloseChats}
                        />
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
