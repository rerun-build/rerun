'use client'

import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'rerun-admin-nav-groups'

type GroupState = Record<string, boolean>

function load(): GroupState {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        return JSON.parse(raw) as GroupState
    } catch {
        return {}
    }
}

let current: GroupState | null = null
const listeners = new Set<() => void>()

function getSnapshot(): GroupState {
    if (current === null) current = load()
    return current
}

function setState(next: GroupState) {
    current = next
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
    for (const l of listeners) l()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    const onStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
            current = load()
            listener()
        }
    }
    window.addEventListener('storage', onStorage)
    return () => {
        listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
    }
}

const SERVER_SNAPSHOT: GroupState = {}

export function useAdminNavGroups() {
    const groups = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)

    const setGroupOpen = useCallback((label: string, open: boolean) => {
        setState({ ...getSnapshot(), [label]: open })
    }, [])

    return { groups, setGroupOpen }
}
