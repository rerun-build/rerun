'use client'

import { useCallback, useSyncExternalStore } from 'react'

export type ModelSelection = { connectionId?: string; model?: string }

function storageKey(agentId: string) {
    return `rerun-agent-model-${agentId}`
}

function load(agentId: string): ModelSelection {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(storageKey(agentId))
        if (!raw) return {}
        const parsed = JSON.parse(raw) as ModelSelection & { provider?: string }
        return parsed.connectionId ? { connectionId: parsed.connectionId, model: parsed.model } : {}
    } catch {
        return {}
    }
}

const EMPTY: ModelSelection = {}
const snapshots = new Map<string, ModelSelection>()
const listeners = new Map<string, Set<() => void>>()

function getSnapshot(agentId: string): ModelSelection {
    let snap = snapshots.get(agentId)
    if (!snap) {
        snap = load(agentId)
        snapshots.set(agentId, snap)
    }
    return snap
}

function emit(agentId: string) {
    for (const l of listeners.get(agentId) ?? []) l()
}

function setSelection(agentId: string, selection: ModelSelection) {
    snapshots.set(agentId, selection)
    try {
        localStorage.setItem(storageKey(agentId), JSON.stringify(selection))
    } catch {}
    emit(agentId)
}

function subscribe(agentId: string, listener: () => void) {
    let set = listeners.get(agentId)
    if (!set) {
        set = new Set()
        listeners.set(agentId, set)
    }
    set.add(listener)
    const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey(agentId)) {
            snapshots.set(agentId, load(agentId))
            listener()
        }
    }
    window.addEventListener('storage', onStorage)
    return () => {
        set.delete(listener)
        window.removeEventListener('storage', onStorage)
    }
}

export function readAgentModel(agentId: string): ModelSelection {
    return getSnapshot(agentId)
}

export function useAgentModel(agentId: string) {
    const selection = useSyncExternalStore(
        cb => subscribe(agentId, cb),
        () => getSnapshot(agentId),
        () => EMPTY
    )

    const select = useCallback(
        (next: ModelSelection) => setSelection(agentId, next),
        [agentId]
    )

    return { selection, select }
}
