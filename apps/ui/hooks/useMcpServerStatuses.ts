'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { CustomMcpStatus } from '@/lib/services/types'

export type McpServerStatuses = { statuses: ReadonlyMap<string, CustomMcpStatus>; loading: boolean; checkedAt: number | null }

const EMPTY: McpServerStatuses = { statuses: new Map(), loading: true, checkedAt: null }

const snapshots = new Map<string, McpServerStatuses>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Set<string>()
const rerun = new Set<string>()

function emit(agentId: string) {
    for (const listener of listeners.get(agentId) ?? []) listener()
}

async function load(agentId: string) {
    if (inflight.has(agentId)) {
        rerun.add(agentId)
        return
    }
    inflight.add(agentId)
    const previous = snapshots.get(agentId)
    snapshots.set(agentId, { statuses: previous?.statuses ?? new Map(), loading: true, checkedAt: previous?.checkedAt ?? null })
    emit(agentId)
    let servers: CustomMcpStatus[] = []
    try {
        const res = await fetch(`/api/agents/${agentId}/mcp-status`)
        if (res.ok) servers = ((await res.json()) as { servers: CustomMcpStatus[] }).servers
    } catch {}
    inflight.delete(agentId)
    snapshots.set(agentId, { statuses: new Map(servers.map(s => [s.name, s])), loading: false, checkedAt: Date.now() })
    emit(agentId)
    if (rerun.delete(agentId)) void load(agentId)
}

function subscribe(agentId: string, listener: () => void) {
    let set = listeners.get(agentId)
    if (!set) {
        set = new Set()
        listeners.set(agentId, set)
    }
    set.add(listener)
    const held = snapshots.get(agentId)
    if (!held) void load(agentId)
    else if (!held.loading && [...held.statuses.values()].some(s => s.status === 'error' || s.status === 'unknown')) void load(agentId)
    return () => {
        set.delete(listener)
    }
}

export function refreshMcpServerStatuses(agentId: string) {
    void load(agentId)
}

export function useMcpServerStatuses(agentId?: string): McpServerStatuses {
    const subscribeToAgent = useCallback((cb: () => void) => (agentId ? subscribe(agentId, cb) : () => {}), [agentId])
    return useSyncExternalStore(
        subscribeToAgent,
        () => (agentId ? (snapshots.get(agentId) ?? EMPTY) : EMPTY),
        () => EMPTY,
    )
}
