'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { listSkillSummariesAction } from '@/app/api/_actions/agent.actions'
import type { EngineSkillSummary } from '@/lib/engine/types'

const NONE: EngineSkillSummary[] = []

const snapshots = new Map<string, EngineSkillSummary[]>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Set<string>()

function emit(agentId: string) {
    for (const listener of listeners.get(agentId) ?? []) listener()
}

async function load(agentId: string) {
    if (inflight.has(agentId)) return
    inflight.add(agentId)
    try {
        snapshots.set(agentId, await listSkillSummariesAction(agentId))
    } finally {
        inflight.delete(agentId)
    }
    emit(agentId)
}

function subscribe(agentId: string, listener: () => void) {
    let set = listeners.get(agentId)
    if (!set) {
        set = new Set()
        listeners.set(agentId, set)
    }
    set.add(listener)
    if (!snapshots.has(agentId)) void load(agentId)
    return () => {
        set.delete(listener)
    }
}

export function invalidateAgentSkillSummaries(agentId: string) {
    if (snapshots.has(agentId) || listeners.get(agentId)?.size) void load(agentId)
}

export function setAgentSkillSummaries(agentId: string, skills: EngineSkillSummary[]) {
    snapshots.set(agentId, skills.map(({ slug, name, description }) => ({ slug, name, description })))
    emit(agentId)
}

export function useAgentSkillSummaries(agentId: string): EngineSkillSummary[] {
    const subscribeToAgent = useCallback((listener: () => void) => subscribe(agentId, listener), [agentId])
    return useSyncExternalStore(
        subscribeToAgent,
        () => snapshots.get(agentId) ?? NONE,
        () => NONE,
    )
}
