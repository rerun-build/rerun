'use client'

import { MAX_OPEN_CHATS, type Arrival, type OpenChat } from '@rerun/contracts'
import { nanoid } from 'nanoid'
import { useCallback, useEffect, useRef, useState } from 'react'
import { adoptDraftModel, draftConversationId, forgetDraftModel } from '@/hooks/useAgentModel'

export type SessionTab = {
    uid: string
    id: string | null
    title: string
    // The coworker's main conversation: pinned first, never closed, never written to storage.
    kind?: 'general'
}

export type SessionTabsState = {
    tabs: SessionTab[]
    activeIndex: number
    // Moves on each time the hub's list is applied: what the tabs became then is not the person's doing.
    hubRevision?: number
}

export const GENERAL_TAB_TITLE = 'General'
export const NEW_THREAD_TITLE = 'New conversation'

export const isGeneralTab = (tab: SessionTab | undefined): boolean => tab?.kind === 'general'

const isBlankThread = (tab: SessionTab): boolean => tab.id === null && !isGeneralTab(tab)

export const generalTabUid = (agentId: string) => `general:${agentId}`

// Its id is null until the row is known: read on mount, or created by the first message sent there.
function generalTab(agentId: string): SessionTab {
    return { uid: generalTabUid(agentId), id: null, title: GENERAL_TAB_TITLE, kind: 'general' }
}

// General learns its row id. A thread tab opened on that same id before it was known (a notification,
// the inbox, the search) folds into the pinned tab, so one conversation never has two tabs.
export function adoptGeneralId(state: SessionTabsState, sessionId: string): SessionTabsState {
    const general = state.tabs[0]
    if (!isGeneralTab(general)) return state
    const duplicates = state.tabs.map((tab, index) => (index > 0 && tab.id === sessionId ? index : -1)).filter(index => index !== -1)
    if (general.id === sessionId && duplicates.length === 0) return state
    const tabs = [{ ...general, id: sessionId }, ...state.tabs.filter((_, index) => index > 0 && !duplicates.includes(index))]
    const activeIndex = duplicates.includes(state.activeIndex) ? 0 : state.activeIndex - duplicates.filter(index => index < state.activeIndex).length
    return { ...state, tabs, activeIndex }
}

// Keeps the newest threads, and always the active one: a list saved under the old, higher ceiling
// can hold it among the oldest. General, when it leads the list, is neither counted nor dropped.
export function remember(state: SessionTabsState): SessionTabsState {
    const pinned = isGeneralTab(state.tabs[0]) ? state.tabs.slice(0, 1) : []
    const threads = state.tabs.slice(pinned.length)
    if (threads.length <= MAX_OPEN_CHATS) return state
    const active = state.tabs[state.activeIndex]
    const newest = threads.slice(-MAX_OPEN_CHATS)
    const kept = !active || isGeneralTab(active) || newest.includes(active) ? newest : [active, ...newest.slice(1)]
    const tabs = [...pinned, ...kept]
    return { ...state, tabs, activeIndex: Math.max(0, tabs.indexOf(active)) }
}

// The threads the hub holds, in its order, then what only this device knows: a draft, and a thread
// `keep` says the hub has not heard of yet.
export function arriveTabs(state: SessionTabsState, arrival: Arrival, chats: OpenChat[], keep: (sessionId: string) => boolean): SessionTabsState {
    const pinned = isGeneralTab(state.tabs[0]) ? state.tabs.slice(0, 1) : []
    const threads = state.tabs.slice(pinned.length)
    const titles = new Map(chats.map(chat => [chat.id, chat.title]))
    const open = arrival.openIds.map((id): SessionTab => {
        const tab = threads.find(thread => thread.id === id) ?? { uid: nanoid(), id, title: NEW_THREAD_TITLE }
        const title = titles.get(id) ?? tab.title
        return title === tab.title ? tab : { ...tab, title }
    })
    const local = threads.filter(thread => thread.id === null || (!arrival.openIds.includes(thread.id) && keep(thread.id)))
    const tabs = [...pinned, ...open, ...local]
    const stays = state.tabs[state.activeIndex]
    const active = arrival.activeId === undefined ? tabs.findIndex(tab => tab.uid === stays?.uid) : arrival.activeId === null ? 0 : tabs.findIndex(tab => tab.id === arrival.activeId)
    return { tabs, activeIndex: Math.max(0, active), hubRevision: (state.hubRevision ?? 0) + 1 }
}

function getStorageKey(agentId: string) {
    return `session-tabs-${agentId}`
}

function newTab(): SessionTab {
    return { uid: nanoid(), id: null, title: NEW_THREAD_TITLE }
}

// What the storage holds: the threads only. `pinned` says the saved `activeIndex` already counts
// General in front; a state saved before General existed counted threads from zero.
type StoredState = { tabs: SessionTab[]; activeIndex: number; pinned?: 'general' }

export function loadFromStorage(agentId: string): SessionTabsState | null {
    try {
        const raw = localStorage.getItem(getStorageKey(agentId))
        if (!raw) return null
        const parsed = JSON.parse(raw) as StoredState
        if (!parsed?.tabs) return null
        // Migration: anciens onglets stockés sans `uid` → en générer un. Le plafond a baissé
        // depuis que les onglets se voient : un état sauvé au-dessus est ramené dessous.
        const threads = parsed.tabs.filter(t => !isGeneralTab(t)).map(t => (t.uid ? t : { ...t, uid: nanoid() }))
        const activeIndex = Math.min(Math.max(0, (parsed.activeIndex ?? 0) + (parsed.pinned === 'general' ? 0 : 1)), threads.length)
        return remember({ tabs: [generalTab(agentId), ...threads], activeIndex })
    } catch {
        return null
    }
}

export function saveToStorage(agentId: string, state: SessionTabsState) {
    try {
        const stored: StoredState = { tabs: state.tabs.filter(t => !isGeneralTab(t)), activeIndex: state.activeIndex, pinned: 'general' }
        localStorage.setItem(getStorageKey(agentId), JSON.stringify(stored))
    } catch {}
}

const freshState = (agentId: string): SessionTabsState => ({ tabs: [generalTab(agentId)], activeIndex: 0 })

// `opensOnGeneral`: the chat always opens on General, whatever tab was on screen last.
function initialState(agentId: string, opensOnGeneral: boolean): SessionTabsState {
    const state = loadFromStorage(agentId) ?? freshState(agentId)
    return opensOnGeneral ? { ...state, activeIndex: 0 } : state
}

export function useSessionTabs(agentId: string, { opensOnGeneral = false }: { opensOnGeneral?: boolean } = {}) {
    const [state, setState] = useState<SessionTabsState>(() => initialState(agentId, opensOnGeneral))

    const stateRef = useRef(state)
    stateRef.current = state

    const loadedFor = useRef(agentId)
    useEffect(() => {
        if (loadedFor.current === agentId) return
        loadedFor.current = agentId
        // The General id resolved so far belongs to the previous coworker: the new one resolves its own.
        setState(prev => ({ ...initialState(agentId, opensOnGeneral), hubRevision: (prev.hubRevision ?? 0) + 1 }))
    }, [agentId, opensOnGeneral])

    useEffect(() => {
        saveToStorage(agentId, state)
    }, [agentId, state])

    const activeSessionId = state.tabs[state.activeIndex]?.id ?? null

    // A conversation nobody has spoken in yet is the new one: asking again lands on it, back on the
    // coworker's default model unless it is already on screen.
    const createNew = useCallback(() => {
        const { tabs, activeIndex } = stateRef.current
        const waiting = tabs.findIndex(isBlankThread)
        if (waiting !== -1 && waiting !== activeIndex) forgetDraftModel(agentId, draftConversationId(tabs[waiting].uid))
        setState(prev => {
            const blank = prev.tabs.findIndex(isBlankThread)
            if (blank !== -1) return { ...prev, activeIndex: blank }
            return { ...prev, tabs: [...prev.tabs, newTab()], activeIndex: prev.tabs.length }
        })
    }, [agentId])

    const selectTab = useCallback((index: number) => {
        setState(prev => (index === prev.activeIndex ? prev : { ...prev, activeIndex: index }))
    }, [])

    // Closing the last thread leaves General on screen: it is never closed itself.
    const closeTab = useCallback((index: number) => {
        setState(prev => {
            if (isGeneralTab(prev.tabs[index])) return prev
            const newTabs = prev.tabs.filter((_, i) => i !== index)
            let newActive = prev.activeIndex
            if (index === prev.activeIndex) {
                newActive = Math.min(index, newTabs.length - 1)
            } else if (index < prev.activeIndex) {
                newActive = prev.activeIndex - 1
            }
            return { ...prev, tabs: newTabs, activeIndex: Math.max(0, newActive) }
        })
    }, [])

    // A draft takes no thread's place: what the ceiling closes here is closed on every device.
    const openTab = useCallback((sessionId: string, title: string, { draft = false }: { draft?: boolean } = {}) => {
        setState(prev => {
            const existing = prev.tabs.findIndex(t => t.id === sessionId)
            if (existing !== -1) {
                return { ...prev, activeIndex: existing }
            }
            const opened = { ...prev, tabs: [...prev.tabs, { uid: nanoid(), id: sessionId, title }], activeIndex: prev.tabs.length }
            return draft ? opened : remember(opened)
        })
    }, [])

    // The pick moves before the tab learns its session: the first render that reads the session already
    // finds it, and the picker has nothing to repair.
    const updateTabByUid = useCallback(
        (uid: string, sessionId: string, title?: string) => {
            adoptDraftModel(agentId, draftConversationId(uid), sessionId)
            setState(prev => ({
                ...prev,
                tabs: prev.tabs.map(t => (t.uid === uid ? { ...t, id: sessionId, title: isGeneralTab(t) ? t.title : (title ?? t.title) } : t)),
            }))
        },
        [agentId]
    )

    // General keeps its name whatever the hub writes on its row.
    const updateTabTitle = useCallback((sessionId: string, title: string) => {
        setState(prev => ({
            ...prev,
            tabs: prev.tabs.map(t => (t.id === sessionId && !isGeneralTab(t) ? { ...t, title } : t)),
        }))
    }, [])

    const setGeneralSessionId = useCallback(
        (sessionId: string) => {
            adoptDraftModel(agentId, draftConversationId(generalTabUid(agentId)), sessionId)
            setState(prev => adoptGeneralId(prev, sessionId))
        },
        [agentId]
    )

    const applyArrival = useCallback((arrival: Arrival, chats: OpenChat[], keep: (sessionId: string) => boolean) => {
        setState(prev => arriveTabs(prev, arrival, chats, keep))
    }, [])

    return {
        tabs: state.tabs,
        activeIndex: state.activeIndex,
        hubRevision: state.hubRevision ?? 0,
        activeSessionId,
        createNew,
        selectTab,
        closeTab,
        openTab,
        updateTabByUid,
        updateTabTitle,
        setGeneralSessionId,
        applyArrival,
    }
}

export type SessionTabs = ReturnType<typeof useSessionTabs>
