'use client'

import type { CoworkerDockCoworker, CoworkerDockState } from '@rerun/contracts'
import { buddyMoodOfStatus } from '@rerun/ui/iso-grid'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { inboxCount, useInboxItems, type InboxItem } from '@/hooks/useInboxItems'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { desktopShell } from '@/lib/desktop-shell/client'
import { openInboxItem } from '@/lib/notifications/open-inbox-item'
import { sidebarSections } from '@/lib/workspace-view'
import { useBoardStore } from '@/stores/board.store'
import { useBuilderDialogsStore } from '@/stores/builder-dialogs.store'
import { useForemanStore } from '@/stores/foreman.store'

const subscribe = () => () => {}
const hasDock = () => desktopShell('coworkerDock') !== null
const onServer = () => false

// A question or an approval first, then the last run that finished.
function mostUrgent(items: readonly InboxItem[], agentId: string): InboxItem | undefined {
    const own = items.filter(item => item.agentId === agentId)
    return own.find(item => item.status !== 'done') ?? own.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
}

function Publisher() {
    const agents = useBoardStore(s => s.agents)
    const spaces = useBoardStore(s => s.spaces)
    // The same items, and the same rule, as the badge of the app icon.
    const onEngine = useForemanStore(s => s.surface === 'engine')
    const { items } = useInboxItems()
    const { needsMachineReason } = useWorkspaceAccess()

    const coworkers = useMemo<CoworkerDockCoworker[]>(() => {
        const pending = new Map<string, number>()
        if (onEngine) for (const item of items) pending.set(item.agentId, (pending.get(item.agentId) ?? 0) + inboxCount([item]))
        return sidebarSections(agents, spaces)
            .flatMap(section => section.members)
            .map(agent => ({ id: agent.id, name: agent.name, mood: buddyMoodOfStatus(agent.status, !!agent.disabledAt), pending: pending.get(agent.id) ?? 0 }))
    }, [agents, spaces, items, onEngine])

    // A workspace without coworkers (a new account in onboarding) has no dock to show.
    const state = useMemo<CoworkerDockState>(() => (coworkers.length > 0 ? { coworkers, createBlockedReason: needsMachineReason } : null), [coworkers, needsMachineReason])
    const published = useRef('')
    useEffect(() => {
        const key = JSON.stringify(state)
        if (key === published.current) return
        published.current = key
        desktopShell('coworkerDock')?.coworkerDock?.publish(state)
    }, [state])

    useEffect(
        () => () => {
            published.current = ''
            desktopShell('coworkerDock')?.coworkerDock?.publish(null)
        },
        []
    )

    const itemsRef = useRef(items)
    useEffect(() => {
        itemsRef.current = items
    }, [items])
    useEffect(() => {
        const dock = desktopShell('coworkerDock')?.coworkerDock
        if (!dock) return
        const stopOpen = dock.onOpen(agentId => {
            const item = mostUrgent(itemsRef.current, agentId)
            if (item) openInboxItem(item)
            else useBoardStore.getState().openAgentChat(agentId)
        })
        const stopCreate = dock.onCreate(() => useBuilderDialogsStore.getState().openNewAgent())
        return () => {
            stopOpen()
            stopCreate()
        }
    }, [])

    return null
}

/** Tells the desktop app's coworker dock who is in this workspace, what each coworker is doing and what it has for the person; opens what the dock asks for. */
export function CoworkerDockPublisher() {
    return useSyncExternalStore(subscribe, hasDock, onServer) ? <Publisher /> : null
}
