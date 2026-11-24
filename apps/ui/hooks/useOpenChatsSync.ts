'use client'

import { arrive, type ArrivalKind, type OpenChatChange, type ResumeChat } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isGeneralTab, type SessionTab, type SessionTabs } from '@/hooks/useSessionTabs'
import { chatDevice, openChatsSync } from '@/lib/chat/open-chats-client'
import { useSession } from '@/supabase/session/SessionProvider'

// Coming back to a window fires both `focus` and `visibilitychange`, and alt-tabbing fires them in bursts.
const RETURN_THROTTLE_MS = 5000
// A conversation opened from elsewhere is asked for around the moment its coworker comes on screen.
const DIRECT_OPEN_MS = 1500

type View = { openIds: string[]; activeId: string | null | undefined }

const always = () => true

function viewOf(tabs: SessionTab[], activeIndex: number, syncable: (sessionId: string) => boolean): View {
    const active = tabs[activeIndex]
    const shared = (tab: SessionTab | undefined) => (tab?.id && !isGeneralTab(tab) && syncable(tab.id) ? tab.id : undefined)
    return { openIds: tabs.flatMap(tab => shared(tab) ?? []), activeId: isGeneralTab(active) ? null : shared(active) }
}

type OpenChatsSyncOptions = {
    agentId: string
    storageKey: string
    tabs: Pick<SessionTabs, 'tabs' | 'activeIndex' | 'hubRevision' | 'applyArrival'>
    // The chat is the one in front of the person: it reads the hub's list as it becomes so.
    onScreen: boolean
    // False for a conversation the hub has not written down yet.
    syncable?: (sessionId: string) => boolean
    // Where General comes back by itself (the Chief of Staff), only `pickGeneral` says the person chose it.
    generalPickedByTab?: boolean
    onShowGeneral?: () => void
}

/**
 * A chat's open conversations, kept the same on every device of the person. The tabs show what this
 * browser remembers, then what the hub holds; each change made here leaves on its own. `resume` is the
 * conversation picked last on another device, offered over the composer.
 */
export function useOpenChatsSync({ agentId, storageKey, tabs: { tabs, activeIndex, hubRevision, applyArrival }, onScreen, syncable = always, generalPickedByTab = true, onShowGeneral }: OpenChatsSyncOptions) {
    const userId = useSession().user?.id
    const sync = useMemo(() => (userId ? openChatsSync(agentId, storageKey, userId) : null), [agentId, storageKey, userId])
    const [resume, setResume] = useState<ResumeChat | null>(null)

    const view = useMemo(() => viewOf(tabs, activeIndex, syncable), [tabs, activeIndex, syncable])
    const latest = useRef({ view, syncable, onShowGeneral })
    latest.current = { view, syncable, onShowGeneral }

    const baseline = useRef({ view, hubRevision, sync })
    const lastActive = useRef(view.activeId)
    useEffect(() => {
        const before = baseline.current
        baseline.current = { view, hubRevision, sync }
        const activeBefore = lastActive.current
        if (view.activeId !== undefined) lastActive.current = view.activeId
        if (!sync || before.sync !== sync || before.hubRevision !== hubRevision) return
        const closed = before.view.openIds.filter(id => !view.openIds.includes(id)).map((sessionId): OpenChatChange => ({ type: 'close', sessionId }))
        const picked = view.activeId !== undefined && view.activeId !== activeBefore && (view.activeId !== null || generalPickedByTab)
        sync.record(...closed, ...(picked ? [{ type: 'select' as const, sessionId: view.activeId ?? null }] : []))
        setResume(current => (current && (view.activeId !== before.view.activeId || closed.some(change => change.sessionId === current.sessionId)) ? null : current))
    }, [view, hubRevision, sync, generalPickedByTab])

    const openedDirectlyAt = useRef(0)
    const stay = useCallback(() => {
        openedDirectlyAt.current = Date.now()
    }, [])

    const load = useCallback(
        async (kind: ArrivalKind, alive: () => boolean) => {
            if (!sync) return
            const startedAt = Date.now()
            const settled = await sync.settle(() => latest.current.view)
            if (!settled || !alive()) return
            const { server, changedHere } = settled
            const direct = changedHere || openedDirectlyAt.current > startedAt - DIRECT_OPEN_MS
            const arrival = arrive(server, { deviceId: chatDevice().id, activeId: latest.current.view.activeId, dismissedAt: sync.dismissedAt }, direct ? 'opened-on' : kind)
            applyArrival(arrival, server.chats, id => !latest.current.syncable(id))
            if (arrival.activeId === null && latest.current.view.activeId !== null) latest.current.onShowGeneral?.()
            setResume(arrival.resume)
        },
        [sync, applyArrival]
    )

    useEffect(() => {
        if (!onScreen) return
        let alive = true
        let returnedAt = Date.now()
        void load('opening', () => alive)
        const onReturn = () => {
            if (document.visibilityState !== 'visible' || Date.now() - returnedAt < RETURN_THROTTLE_MS) return
            returnedAt = Date.now()
            void load('returning', () => alive)
        }
        window.addEventListener('focus', onReturn)
        document.addEventListener('visibilitychange', onReturn)
        return () => {
            alive = false
            window.removeEventListener('focus', onReturn)
            document.removeEventListener('visibilitychange', onReturn)
        }
    }, [onScreen, load])

    useEffect(() => {
        if (!sync) return
        const leave = () => void sync.flush()
        window.addEventListener('pagehide', leave)
        return () => {
            window.removeEventListener('pagehide', leave)
            leave()
        }
    }, [sync])

    const dismiss = useCallback(() => {
        if (resume) sync?.dismiss(resume.changedAt)
        setResume(null)
    }, [sync, resume])

    const pickGeneral = useCallback(() => {
        lastActive.current = null
        setResume(null)
        sync?.record({ type: 'select', sessionId: null })
    }, [sync])

    return { resume, dismiss, stay, pickGeneral }
}
