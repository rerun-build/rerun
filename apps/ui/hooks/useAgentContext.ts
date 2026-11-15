'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { getAgentContextAction, type AgentContext, type ModelSelectorContext } from '@/app/api/_actions/agent.actions'

export type AgentContextState = { context: AgentContext | null; loaded: boolean }

const EMPTY: AgentContextState = { context: null, loaded: false }

const snapshots = new Map<string, AgentContextState>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Set<string>()

function emit(agentId: string) {
    for (const listener of listeners.get(agentId) ?? []) listener()
}

const FAILED_READ_RETRY_MS = 3_000
const FAILED_READ_RETRIES = 3

async function load(agentId: string, attempt = 0) {
    if (inflight.has(agentId)) return
    inflight.add(agentId)
    let context: AgentContext
    try {
        context = await getAgentContextAction(agentId)
        snapshots.set(agentId, { context, loaded: true })
    } finally {
        inflight.delete(agentId)
    }
    emit(agentId)
    if (!context.model.loaded && attempt < FAILED_READ_RETRIES) {
        setTimeout(() => {
            if (listeners.get(agentId)?.size && !snapshots.get(agentId)?.context?.model.loaded) void load(agentId, attempt + 1)
        }, FAILED_READ_RETRY_MS)
    }
}

function subscribe(agentId: string, listener: () => void) {
    let set = listeners.get(agentId)
    if (!set) {
        set = new Set()
        listeners.set(agentId, set)
    }
    set.add(listener)
    const current = snapshots.get(agentId)
    if (!current || !current.context?.model.loaded) void load(agentId)
    return () => {
        set.delete(listener)
    }
}

export function invalidateAgentContext(agentId: string) {
    void load(agentId)
}

export function invalidateLoadedAgentContexts() {
    for (const agentId of snapshots.keys()) void load(agentId)
}

export function patchAgentModel(agentId: string, model: Partial<ModelSelectorContext>) {
    const current = snapshots.get(agentId)?.context
    if (!current) return
    snapshots.set(agentId, { context: { ...current, model: { ...current.model, ...model } }, loaded: true })
    emit(agentId)
}

export function useAgentContext(agentId: string): AgentContextState {
    const subscribeToAgent = useCallback((listener: () => void) => subscribe(agentId, listener), [agentId])
    return useSyncExternalStore(
        subscribeToAgent,
        () => snapshots.get(agentId) ?? EMPTY,
        () => EMPTY,
    )
}
