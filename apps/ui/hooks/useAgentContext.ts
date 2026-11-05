'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { getAgentContextAction, type AgentContext, type ModelSelectorContext } from '@/app/api/_actions/agent.actions'

// The model picker and the setup gate both read the agent from its Box, and both mount with every
// conversation tab, every composer swap and every panel. One store per agent keeps that to a
// single read until something changes the agent. A read that failed is not kept: the next mount
// asks again, the way every mount used to.

export type AgentContextState = { context: AgentContext | null; loaded: boolean }

const EMPTY: AgentContextState = { context: null, loaded: false }

const snapshots = new Map<string, AgentContextState>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Set<string>()

function emit(agentId: string) {
    for (const listener of listeners.get(agentId) ?? []) listener()
}

// A failed read is asked again while a picker still shows the agent, so it does not wait on a spinner
// for the next mount.
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

// Re-reads the agent while what is known keeps showing.
export function invalidateAgentContext(agentId: string) {
    void load(agentId)
}

// Every agent read so far resolves its model against the box's connections: plugging one in, pulling
// one out or moving the box default changes what each of them runs, pin or not.
export function invalidateLoadedAgentContexts() {
    for (const agentId of snapshots.keys()) void load(agentId)
}

// The pick the user just made, shown everywhere the agent is open before the engine confirms it.
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
