'use client'

import { reasoningEffortSchema, type ReasoningEffort } from '@rerun/contracts'
import { useCallback, useSyncExternalStore } from 'react'

// Per-agent model selection used as a per-message override. Kept in localStorage
// and shared across mounted instances (the in-chat ModelSelector and the chat
// transport) via a tiny external store so a switch takes effect on the very next
// message without mutating the agent's persisted default config.
//
// An empty selection ({}) means "no override" — the engine falls back to the
// agent's configured connection and model. `effort` goes with the model: null asks for the
// provider's default, absent lets the engine take the agent's own.

export type ModelSelection = { connectionId?: string; model?: string; effort?: ReasoningEffort | null }

function storageKey(agentId: string) {
    return `rerun-agent-model-${agentId}`
}

// A selection written before credentials moved to the Box named a provider, not a connection, and
// there is no telling which of two Claude subscriptions it meant. Dropped rather than guessed: the
// agent falls back to its own default on the next message.
function load(agentId: string): ModelSelection {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(storageKey(agentId))
        if (!raw) return {}
        const parsed = JSON.parse(raw) as ModelSelection & { provider?: string }
        if (!parsed.connectionId) return {}
        const effort = reasoningEffortSchema.nullable().safeParse(parsed.effort)
        return { connectionId: parsed.connectionId, model: parsed.model, ...(effort.success ? { effort: effort.data } : {}) }
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

// For a transport building its body at send time, outside of any render.
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
