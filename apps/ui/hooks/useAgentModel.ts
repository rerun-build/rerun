'use client'

import { FOREMAN_AGENT_ID, reasoningEffortSchema, type ReasoningEffort } from '@rerun/contracts'
import type { EngineModelPick } from '@/lib/engine/types'
import { useCallback, useSyncExternalStore } from 'react'

// The model picked in a conversation, sent as a per-message override. Kept in localStorage and
// shared across mounted instances (the in-chat ModelSelector and the chat transport) via a tiny
// external store so a switch takes effect on the very next message without mutating the agent's
// persisted default config.
//
// A coworker's pick belongs to one conversation: a key per agent made a model picked in one chat the
// model of every chat it opened next, ahead of its default (RER-284). The Chief of Staff's picker
// knows no conversation, so its pick still covers the whole agent.
//
// An empty selection ({}) means "no override" — the engine falls back to the
// agent's configured connection and model. `effort` goes with the model: null asks for the
// provider's default, absent lets the engine take the agent's own.

export type ModelSelection = { connectionId?: string; model?: string; effort?: ReasoningEffort | null }

const DRAFT_PREFIX = 'new:'

// A chat not yet sent has no session: its pick waits under the tab's id, in memory only. Asking for a
// new chat again lands on that same tab, which forgets the pick (see useSessionTabs): a new chat always
// opens on the coworker's default.
export function draftConversationId(uid: string): string {
    return `${DRAFT_PREFIX}${uid}`
}

const isDraft = (conversationId: string | undefined) => !!conversationId?.startsWith(DRAFT_PREFIX)

function storeKey(agentId: string, conversationId?: string) {
    return conversationId ? `${agentId}:${conversationId}` : agentId
}

function storageKey(key: string) {
    return `rerun-agent-model-${key}`
}

// A selection written before credentials moved to the Box named a provider, not a connection, and
// there is no telling which of two Claude subscriptions it meant. Dropped rather than guessed: the
// agent falls back to its own default on the next message.
function load(key: string): ModelSelection {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(storageKey(key))
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

function getSnapshot(agentId: string, conversationId?: string): ModelSelection {
    const key = storeKey(agentId, conversationId)
    let snap = snapshots.get(key)
    if (!snap) {
        snap = isDraft(conversationId) ? EMPTY : load(key)
        snapshots.set(key, snap)
    }
    return snap
}

function emit(key: string) {
    for (const l of listeners.get(key) ?? []) l()
}

function setSelection(agentId: string, selection: ModelSelection, conversationId?: string) {
    const key = storeKey(agentId, conversationId)
    snapshots.set(key, selection)
    if (!isDraft(conversationId)) {
        try {
            if (selection.model) localStorage.setItem(storageKey(key), JSON.stringify(selection))
            else localStorage.removeItem(storageKey(key))
        } catch {}
    }
    emit(key)
}

function subscribe(agentId: string, conversationId: string | undefined, listener: () => void) {
    const key = storeKey(agentId, conversationId)
    let set = listeners.get(key)
    if (!set) {
        set = new Set()
        listeners.set(key, set)
    }
    set.add(listener)
    const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey(key)) {
            snapshots.set(key, load(key))
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
export function readAgentModel(agentId: string, conversationId?: string): ModelSelection {
    return getSnapshot(agentId, conversationId)
}

// What accepting a skill proposal carries, read at the click: nothing while the conversation follows
// the coworker. The Chief of Staff's pick covers the agent, as everywhere else.
export function readModelPick(agentId: string, conversationId: string): EngineModelPick | undefined {
    const { connectionId, model } = readAgentModel(agentId, agentId === FOREMAN_AGENT_ID ? undefined : conversationId)
    return connectionId && model ? { connectionId, model } : undefined
}

// The first message of a new chat opened its session: the pick made before it moves there. General's
// session may only just have been read, with a pick of its own, which wins over the one the picker
// repaired in the meantime.
export function adoptDraftModel(agentId: string, draftId: string, sessionId: string) {
    const draft = getSnapshot(agentId, draftId)
    snapshots.delete(storeKey(agentId, draftId))
    if (draft.model && !getSnapshot(agentId, sessionId).model) setSelection(agentId, draft, sessionId)
}

export function forgetDraftModel(agentId: string, draftId: string) {
    if (getSnapshot(agentId, draftId).model) setSelection(agentId, EMPTY, draftId)
}

export function useAgentModel(agentId: string, conversationId?: string) {
    const selection = useSyncExternalStore(
        useCallback(cb => subscribe(agentId, conversationId, cb), [agentId, conversationId]),
        () => getSnapshot(agentId, conversationId),
        () => EMPTY
    )

    const select = useCallback(
        (next: ModelSelection) => setSelection(agentId, next, conversationId),
        [agentId, conversationId]
    )

    return { selection, select }
}
